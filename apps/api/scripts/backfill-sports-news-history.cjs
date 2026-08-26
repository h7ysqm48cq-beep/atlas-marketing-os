require("dotenv/config");

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../dist/src/generated/prisma/client.js");

const connectionString =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL must be configured.",
  );
}

const apply = process.env.APPLY === "1";
const parsedLimit = Number(process.env.LIMIT || "200");
const limit =
  Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(Math.floor(parsedLimit), 1000)
    : 200;

const adapter = new PrismaPg({
  connectionString,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const prisma = new PrismaClient({ adapter });

function isSportsNewsPost(post) {
  const settings = post.brandRenderingSettings;

  return Boolean(
    settings &&
      typeof settings === "object" &&
      !Array.isArray(settings) &&
      Object.prototype.hasOwnProperty.call(settings, "sportsNews"),
  );
}

function groupPosts(posts) {
  const groups = new Map();

  for (const post of posts.filter(isSportsNewsPost)) {
    const title = post.title && post.title.trim();
    const fallbackDate = new Date(post.scheduledAt).toISOString().slice(0, 10);
    const key = [post.brandId, title || `Sports News ${fallbackDate}`].join("|");
    const current = groups.get(key) || [];
    current.push(post);
    groups.set(key, current);
  }

  return [...groups.values()];
}

async function main() {
  const posts = await prisma.scheduledPost.findMany({
    where: {
      historyId: null,
    },
    orderBy: {
      scheduledAt: "asc",
    },
    take: limit,
    select: {
      id: true,
      brandId: true,
      platform: true,
      title: true,
      content: true,
      scheduledAt: true,
      status: true,
      publishedAt: true,
      brandRenderingSettings: true,
    },
  });
  const groups = groupPosts(posts);

  console.log(`Sports News candidates: ${groups.length} group(s).`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}.`);

  for (const group of groups) {
    console.log(
      JSON.stringify({
        title: group[0].title,
        scheduledAt: group[0].scheduledAt,
        postIds: group.map((post) => post.id),
        platforms: [...new Set(group.map((post) => post.platform))],
        statuses: group.map((post) => `${post.platform}=${post.status}`),
      }),
    );
  }

  if (!apply) {
    console.log("Nothing was written. Re-run with APPLY=1 to link these posts.");
    return;
  }

  let linkedGroups = 0;
  let linkedPosts = 0;

  for (const group of groups) {
    const result = await prisma.$transaction(async (transaction) => {
      const currentPosts = await transaction.scheduledPost.findMany({
        where: {
          id: {
            in: group.map((post) => post.id),
          },
          historyId: null,
        },
        select: {
          id: true,
          brandId: true,
          platform: true,
          title: true,
          content: true,
          scheduledAt: true,
          status: true,
          publishedAt: true,
        },
      });

      if (!currentPosts.length) {
        return { posts: 0 };
      }

      const platforms = [...new Set(currentPosts.map((post) => post.platform))];
      const activePosts = currentPosts.filter(
        (post) => post.status !== "CANCELLED",
      );
      const allPublished =
        activePosts.length > 0 &&
        activePosts.every((post) => post.status === "PUBLISHED");
      const publishedAt = allPublished
        ? activePosts
            .map((post) => post.publishedAt || post.scheduledAt)
            .sort((left, right) => right.getTime() - left.getTime())[0]
        : null;
      const history = await transaction.generationHistory.create({
        data: {
          brandId: currentPosts[0].brandId,
          topic: currentPosts[0].title || "Sports News",
          platforms,
          style: "M-SPORTS_NEWS",
          language: "zh-en",
          facebook: currentPosts.some((post) => post.platform === "FACEBOOK")
            ? currentPosts.find((post) => post.platform === "FACEBOOK").content
            : "",
          telegram: currentPosts.some((post) => post.platform === "TELEGRAM")
            ? currentPosts.find((post) => post.platform === "TELEGRAM").content
            : "",
          reels: "",
          imagePrompt: "",
          status: allPublished ? "PUBLISHED" : "DRAFT",
          publishedAt,
          analysis: {
            source: "SPORTS_NEWS_HISTORY_BACKFILL",
            scheduledPostIds: currentPosts.map((post) => post.id),
            scheduledAt: currentPosts[0].scheduledAt.toISOString(),
            statuses: currentPosts.map((post) => ({
              platform: post.platform,
              status: post.status,
            })),
          },
        },
      });

      const updated = await transaction.scheduledPost.updateMany({
        where: {
          id: {
            in: currentPosts.map((post) => post.id),
          },
          historyId: null,
        },
        data: {
          historyId: history.id,
        },
      });

      return { posts: updated.count };
    });

    if (result.posts > 0) {
      linkedGroups += 1;
      linkedPosts += result.posts;
    }
  }

  console.log(`Linked ${linkedPosts} post(s) in ${linkedGroups} history group(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
