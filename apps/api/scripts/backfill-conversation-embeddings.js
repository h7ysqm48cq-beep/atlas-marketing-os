require("dotenv").config();

const OpenAI = require("openai").default;
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  PrismaClient,
} = require("../dist/src/generated/prisma/client.js");

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured");
}

const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const prisma = new PrismaClient({ adapter });
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const MODEL = "text-embedding-3-small";

/*
 * Safety default:
 * only process 5 conversations unless an explicit
 * BACKFILL_LIMIT is supplied.
 */
const parsedLimit = Number(
  process.env.BACKFILL_LIMIT ?? "5"
);

const LIMIT =
  Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildConversationContent(conversation) {
  const messages = [...conversation.messages].reverse();

  if (!messages.length) {
    return null;
  }

  return [
    `Conversation: ${conversation.title}`,
    `Mode: ${conversation.mode}`,
    "",
    ...messages.map(
      (message) =>
        `${message.role === "USER" ? "User" : "Assistant"}: ${message.content}`
    ),
  ]
    .join("\n")
    .slice(0, 6000);
}

async function main() {
  console.log("===== SEMANTIC MEMORY BACKFILL =====");
  console.log(`Model: ${MODEL}`);
  console.log(`Limit: ${LIMIT}`);
  console.log("");

  const before = await prisma.copilotConversationEmbedding.count();

  const conversations =
    await prisma.copilotConversation.findMany({
      where: {
        isArchived: false,

        /*
         * Only missing rows.
         * This makes the script safely resumable.
         */
        copilotConversationEmbedding: {
          is: null,
        },
      },

      select: {
        id: true,
        title: true,
        mode: true,

        messages: {
          select: {
            role: true,
            content: true,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 20,
        },
      },

      orderBy: {
        updatedAt: "desc",
      },

      take: LIMIT,
    });

  console.log(
    `Selected ${conversations.length} missing conversations`
  );

  let success = 0;
  let skipped = 0;
  let failed = 0;

  const failures = [];

  for (let index = 0; index < conversations.length; index++) {
    const conversation = conversations[index];

    console.log("");
    console.log(
      `[${index + 1}/${conversations.length}] ${conversation.title}`
    );
    console.log(`ID: ${conversation.id}`);

    try {
      const content =
        await buildConversationContent(conversation);

      if (!content) {
        skipped++;
        console.log("SKIPPED: no messages");
        continue;
      }

      const result = await openai.embeddings.create({
        model: MODEL,
        input: content,
      });

      const vector = result.data[0]?.embedding;

      if (!vector?.length) {
        throw new Error(
          "OpenAI returned an empty embedding"
        );
      }

      await prisma.copilotConversationEmbedding.upsert({
        where: {
          conversationId: conversation.id,
        },

        update: {
          content,
          vector,
          model: MODEL,
          dimensions: vector.length,
        },

        create: {
          /*
           * Resolve brandId from the conversation itself
           * rather than assuming one global brand.
           */
          brandId: (
            await prisma.copilotConversation.findUniqueOrThrow({
              where: {
                id: conversation.id,
              },
              select: {
                brandId: true,
              },
            })
          ).brandId,

          conversationId: conversation.id,
          content,
          vector,
          model: MODEL,
          dimensions: vector.length,
        },
      });

      success++;

      console.log(
        `SUCCESS: ${vector.length} dimensions`
      );
    } catch (error) {
      failed++;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      failures.push({
        conversationId: conversation.id,
        title: conversation.title,
        error: message,
      });

      console.error(`FAILED: ${message}`);
    }

    /*
     * Small delay keeps this deliberately conservative.
     */
    if (index < conversations.length - 1) {
      await sleep(250);
    }
  }

  const [after, active] = await Promise.all([
    prisma.copilotConversationEmbedding.count(),

    prisma.copilotConversation.count({
      where: {
        isArchived: false,
      },
    }),
  ]);

  const remaining =
    await prisma.copilotConversation.count({
      where: {
        isArchived: false,
        copilotConversationEmbedding: {
          is: null,
        },
      },
    });

  console.log("");
  console.log("===== BACKFILL RESULT =====");
  console.log({
    selected: conversations.length,
    success,
    skipped,
    failed,
    embeddingsBefore: before,
    embeddingsAfter: after,
    activeConversations: active,
    remainingMissing: remaining,
  });

  if (failures.length) {
    console.log("");
    console.log("===== FAILURES =====");
    console.table(failures);
  }
}

main()
  .catch((error) => {
    console.error("");
    console.error("BACKFILL FATAL ERROR:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
