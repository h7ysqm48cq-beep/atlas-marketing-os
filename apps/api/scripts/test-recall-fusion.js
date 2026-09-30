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
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const prisma = new PrismaClient({
  adapter,
});

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "text-embedding-3-small";
const THRESHOLD = 0.45;

function cosine(a, b) {
  if (!a.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  const denominator =
    Math.sqrt(magnitudeA) *
    Math.sqrt(magnitudeB);

  return denominator ? dot / denominator : 0;
}

async function semanticSearch(query) {
  const result = await client.embeddings.create({
    model: MODEL,
    input: query.slice(0, 6000),
  });

  const queryVector = result.data[0]?.embedding || [];

  const rows =
    await prisma.copilotConversationEmbedding.findMany({
      where: {
        conversation: {
          isArchived: false,
        },
      },
      include: {
        conversation: {
          select: {
            title: true,
            mode: true,
            updatedAt: true,
          },
        },
      },
    });

  return rows
    .map((row) => {
      const storedVector = Array.isArray(row.vector)
        ? row.vector
        : [];

      return {
        conversationId: row.conversationId,
        title: row.conversation.title,
        mode: row.conversation.mode,
        content: row.content,
        updatedAt: row.conversation.updatedAt,
        score: cosine(queryVector, storedVector),
      };
    })
    .filter((row) => row.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function extractKeywords(query) {
  const normalized = query
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const keywords = new Set();

  const mSeriesMatches =
    normalized.match(
      /\bM\s+(?:LEADERS|BUSINESS|TECH|BRAND\s+LAB|CONSUMER|MARKET|NEXT|STORY)\b/gi,
    ) ?? [];

  for (const match of mSeriesMatches) {
    keywords.add(
      match
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  const latinTokens =
    normalized.match(
      /[A-Za-z][A-Za-z0-9_-]{2,}/g,
    ) ?? [];

  for (const token of latinTokens) {
    const upper = token.toUpperCase();

    if (
      [
        "THE",
        "AND",
        "WHAT",
        "WAS",
        "WERE",
        "BEFORE",
      ].includes(upper)
    ) {
      continue;
    }

    keywords.add(token);
  }

  const chineseSignals = [
    "满贯门",
    "港剧",
    "怀旧",
    "消费者心理",
    "消费心理",
    "视觉风格",
    "图片",
    "栏目安排",
    "金融",
    "经济",
    "市场变化",
    "科技",
    "创新",
    "商业模式",
    "品牌设计",
  ];

  for (const signal of chineseSignals) {
    if (normalized.includes(signal)) {
      keywords.add(signal);
    }
  }

  return [...keywords]
    .filter((keyword) => keyword.length >= 2)
    .slice(0, 8);
}

async function keywordSearch(query) {
  const keywords = extractKeywords(query);

  if (!keywords.length) {
    return [];
  }

  const conversations =
    await prisma.copilotConversation.findMany({
      where: {
        isArchived: false,

        OR: keywords.flatMap((keyword) => [
          {
            title: {
              contains: keyword,
              mode: "insensitive",
            },
          },
          {
            messages: {
              some: {
                content: {
                  contains: keyword,
                  mode: "insensitive",
                },
              },
            },
          },
        ]),
      },

      select: {
        id: true,
        title: true,
        mode: true,
        updatedAt: true,

        messages: {
          select: {
            role: true,
            content: true,
          },

          orderBy: {
            createdAt: "desc",
          },

          take: 8,
        },
      },

      orderBy: {
        updatedAt: "desc",
      },

      take: 20,
    });

  const normalizedKeywords =
    keywords.map((keyword) =>
      keyword.toLowerCase(),
    );

  return conversations
    .map((conversation) => {
      const searchableText = [
        conversation.title,
        ...conversation.messages.map(
          (message) => message.content,
        ),
      ]
        .join("\n")
        .toLowerCase();

      const matchedKeywords =
        normalizedKeywords.filter(
          (keyword) =>
            searchableText.includes(keyword),
        );

      const keywordScore =
        matchedKeywords.reduce(
          (score, keyword) => {
            const isMSeries =
              /^m\s+(leaders|business|tech|brand\s+lab|consumer|market|next|story)$/i.test(
                keyword,
              );

            return score + (isMSeries ? 3 : 1);
          },
          0,
        );

      return {
        ...conversation,

        messages: conversation.messages
          .reverse()
          .slice(-6),

        matchedKeywords,
        keywordScore,
      };
    })
    .sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) {
        return b.keywordScore - a.keywordScore;
      }

      return (
        new Date(b.updatedAt).getTime() -
        new Date(a.updatedAt).getTime()
      );
    })
    .slice(0, 5);
}

function fuse(keywordResults, semanticResults) {
  const fused = new Map();

  for (const item of semanticResults) {
    fused.set(item.conversationId, {
      conversationId: item.conversationId,
      title: item.title,
      semanticScore: item.score,
      matchedByKeyword: false,
      keywordScore: 0,
      updatedAt: item.updatedAt,
    });
  }

  for (const item of keywordResults) {
    const existing = fused.get(item.id);

    if (existing) {
      existing.matchedByKeyword = true;
      existing.keywordScore =
        item.keywordScore ?? 0;
      continue;
    }

    fused.set(item.id, {
      conversationId: item.id,
      title: item.title,
      semanticScore: null,
      matchedByKeyword: true,
      keywordScore: item.keywordScore ?? 0,
      updatedAt: item.updatedAt,
    });
  }

  return [...fused.values()]
    .sort((a, b) => {
      const scoreA =
        (a.semanticScore ?? 0) +
        (a.keywordScore ?? 0) * 0.1;

      const scoreB =
        (b.semanticScore ?? 0) +
        (b.keywordScore ?? 0) * 0.1;

      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      return (
        new Date(b.updatedAt).getTime() -
        new Date(a.updatedAt).getTime()
      );
    })
    .slice(0, 5);
}

async function test(query) {
  console.log("\n========================================");
  console.log("QUERY:");
  console.log(query);

  const [keyword, semantic] = await Promise.all([
    keywordSearch(query),
    semanticSearch(query),
  ]);

  const fused = fuse(keyword, semantic);

  console.log("\nKEYWORD:");
  console.table(
    keyword.map((x) => ({
      id: x.id,
      title: x.title,
      matches: x.matchedKeywords.join(", "),
      score: x.keywordScore,
    })),
  );

  console.log("\nSEMANTIC:");
  console.table(
    semantic.map((x) => ({
      id: x.conversationId,
      title: x.title,
      similarity:
        `${(x.score * 100).toFixed(1)}%`,
    })),
  );

  console.log("\nFUSED:");
  console.table(
    fused.map((x, index) => ({
      rank: index + 1,
      id: x.conversationId,
      title: x.title,
      semantic:
        x.semanticScore === null
          ? "-"
          : `${(x.semanticScore * 100).toFixed(1)}%`,
      keyword: x.matchedByKeyword ? "YES" : "NO",
      keywordScore: x.keywordScore ?? 0,
      combined:
        (
          (x.semanticScore ?? 0) +
          (x.keywordScore ?? 0) * 0.1
        ).toFixed(3),
    })),
  );

  const ids = fused.map((x) => x.conversationId);

  const duplicates =
    ids.length - new Set(ids).size;

  console.log(
    duplicates === 0
      ? "✓ No duplicate conversations"
      : `✗ Duplicate conversations: ${duplicates}`,
  );
}

async function main() {
  await test(
    "我们之前已经讨论过每周 M 系列的栏目安排，星期一到星期日分别是什么？",
  );

  await test(
    "之前满贯门图片和 Logo 的视觉风格是什么？",
  );

  await test(
    "继续之前 M CONSUMER 的消费者心理方向。",
  );

  await test(
    "之前我们讨论过港剧怀旧内容，你还记得吗？",
  );

  await test(
    "M MARKET 之前讨论过什么方向？",
  );
}

main()
  .catch((error) => {
    console.error("FUSION TEST FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
