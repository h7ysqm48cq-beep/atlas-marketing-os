import type { Page } from "playwright-core";

export type FacebookPublishedPostReference = {
  pageId: string;
  facebookPostId: string;
  externalPostId: string;
  postUrl: string;
  matchedBy: string;
};

const facebookPublishSuccessPatterns = [
  /your post (?:is|was) (?:now )?(?:published|live|shared)/i,
  /your post has been (?:successfully )?(?:published|shared)/i,
  /post (?:published|shared|live) successfully/i,
  /post published/i,
  /帖子已发布/i,
  /贴文已发布/i,
  /siaran anda telah diterbitkan/i,
];

const facebookPublishErrorPatterns = [
  /couldn't publish/i,
  /couldn't be published/i,
  /could not be published/i,
  /unable to publish/i,
  /something went wrong/i,
  /try again later/i,
  /无法发布/i,
  /发布失败/i,
  /tidak dapat menerbitkan/i,
];

export function hasFacebookPublishSuccessSignal(value: string) {
  return facebookPublishSuccessPatterns.some((pattern) => pattern.test(value));
}

export function hasFacebookPublishErrorSignal(value: string) {
  return facebookPublishErrorPatterns.some((pattern) => pattern.test(value));
}

export function shouldRefreshFacebookPublishConfirmation(input: {
  errorSignal: boolean;
  successSignal: boolean;
  composerStillVisible: boolean;
  postReferenceFound: boolean;
}) {
  return (
    !input.errorSignal &&
    !input.successSignal &&
    !input.postReferenceFound
  );
}

export function resolveFacebookPublishVerificationStatus(input: {
  errorSignal: boolean;
  successSignal: boolean;
  composerStillVisible: boolean;
  postReferenceFound: boolean;
  allowComposerClosed?: boolean;
}) {
  if (input.errorSignal) {
    return "FAILED";
  }

  if (input.successSignal || input.postReferenceFound) {
    return "CONFIRMED";
  }

  return input.composerStillVisible || input.allowComposerClosed === false
    ? "UNCONFIRMED"
    : "COMPOSER_CLOSED";
}

export function resolveFacebookPublishedFlag(input: {
  errorSignal: boolean;
  successSignal: boolean;
  composerStillVisible: boolean;
  postReferenceFound: boolean;
  allowComposerClosed?: boolean;
}) {
  return (
    input.successSignal ||
    input.postReferenceFound ||
    (input.allowComposerClosed !== false && !input.composerStillVisible)
  ) && !input.errorSignal;
}

function normalizeText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function createFacebookCaptionFingerprint(caption: string) {
  const lines = caption.split(/\r?\n/).map(normalizeText).filter(Boolean);

  const firstContentLine =
    lines.find((line) => /[\p{L}\p{N}]/u.test(line)) || normalizeText(caption);

  return firstContentLine
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .slice(0, 120)
    .trim();
}

export function extractFacebookPageId(pageUrl: string) {
  try {
    const parsed = new URL(pageUrl);
    const queryId = parsed.searchParams.get("id");

    if (queryId && /^\d+$/.test(queryId)) {
      return queryId;
    }

    const pathMatch = parsed.pathname.match(/^\/(\d+)(?:\/|$)/);

    return pathMatch?.[1] || null;
  } catch {
    return null;
  }
}

function extractFacebookPostId(href: string) {
  try {
    const parsed = new URL(href, "https://www.facebook.com/");

    const photoSet = parsed.searchParams.get("set");
    const photoSetMatch = photoSet?.match(/(?:^|\.)pcb\.(\d+)(?:\.|$)/);

    if (photoSetMatch?.[1]) {
      return {
        postId: photoSetMatch[1],
        matchedBy: "photo-set",
      };
    }

    const storyId = parsed.searchParams.get("story_fbid");

    if (storyId && /^\d+$/.test(storyId)) {
      return {
        postId: storyId,
        matchedBy: "story-fbid",
      };
    }

    const photoId = parsed.searchParams.get("fbid");

    if (
      photoId &&
      /^\d+$/.test(photoId) &&
      /\/photo(?:\.php)?\/?$/i.test(parsed.pathname)
    ) {
      return {
        postId: photoId,
        matchedBy: "photo-fbid",
      };
    }

    const pathMatch = parsed.pathname.match(
      /\/(?:posts|permalink)\/(\d+)(?:\/|$)/,
    );

    if (pathMatch?.[1]) {
      return {
        postId: pathMatch[1],
        matchedBy: "post-path",
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function buildFacebookPublishedPostReference(
  pageUrl: string,
  hrefs: string[],
) {
  const pageId = extractFacebookPageId(pageUrl);

  if (!pageId) {
    return null;
  }

  for (const href of hrefs) {
    const extracted = extractFacebookPostId(href);

    if (!extracted) {
      continue;
    }

    return {
      pageId,
      facebookPostId: extracted.postId,
      externalPostId: `${pageId}_${extracted.postId}`,
      postUrl: `https://www.facebook.com/permalink.php?story_fbid=${extracted.postId}&id=${pageId}`,
      matchedBy: extracted.matchedBy,
    } satisfies FacebookPublishedPostReference;
  }

  return null;
}

export const FACEBOOK_PUBLISHED_POST_MAX_ARTICLES_PER_PASS = 40;
export const FACEBOOK_PUBLISHED_POST_MAX_SCROLLS = 6;
export const FACEBOOK_PUBLISHED_POST_SCROLL_INTERVAL_MS = 700;

export function selectFacebookPublishedPostArticleIndexes(
  totalArticles: number,
  maxArticles = FACEBOOK_PUBLISHED_POST_MAX_ARTICLES_PER_PASS,
) {
  const total = Math.max(0, Math.floor(totalArticles));
  const limit = Math.max(0, Math.floor(maxArticles));

  if (total === 0 || limit === 0) {
    return [] as number[];
  }

  if (total <= limit) {
    return Array.from({ length: total }, (_, index) => index);
  }

  const leadingCount = Math.floor(limit / 2);
  const trailingCount = limit - leadingCount;
  const trailingStart = Math.max(leadingCount, total - trailingCount);

  return [
    ...Array.from({ length: leadingCount }, (_, index) => index),
    ...Array.from(
      { length: total - trailingStart },
      (_, index) => trailingStart + index,
    ),
  ];
}

export function shouldAdvanceFacebookPublishedPostSearch(input: {
  elapsedMs: number;
  lastScrollElapsedMs: number;
  scrollCount: number;
  maxScrolls?: number;
  scrollIntervalMs?: number;
}) {
  const maxScrolls =
    input.maxScrolls ?? FACEBOOK_PUBLISHED_POST_MAX_SCROLLS;
  const scrollIntervalMs =
    input.scrollIntervalMs ?? FACEBOOK_PUBLISHED_POST_SCROLL_INTERVAL_MS;

  return (
    input.scrollCount < maxScrolls &&
    input.elapsedMs - input.lastScrollElapsedMs >= scrollIntervalMs
  );
}

export async function findFacebookPublishedPostReference(
  page: Page,
  caption: string,
  timeoutMs = 8000,
) {
  const fingerprint = createFacebookCaptionFingerprint(caption);

  if (fingerprint.length < 6) {
    return null;
  }

  const normalizedFingerprint = normalizeText(fingerprint).toLocaleLowerCase();
  const startedAt = Date.now();
  let scrollCount = 0;
  let lastScrollElapsedMs = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const articles = page.locator('[role="article"]');

    const matchingArticles = articles.filter({
      hasText: fingerprint,
    });
    const matchingArticleCount = Math.min(
      await matchingArticles.count().catch(() => 0),
      5,
    );

    for (let index = 0; index < matchingArticleCount; index += 1) {
      const hrefs = await matchingArticles
        .nth(index)
        .locator("a[href]")
        .evaluateAll((anchors) =>
          anchors
            .map((anchor) => anchor.getAttribute("href"))
            .filter((href): href is string => Boolean(href)),
        )
        .catch(() => []);

      const reference = buildFacebookPublishedPostReference(page.url(), hrefs);

      if (reference) {
        return {
          ...reference,
          matchedBy: `caption-article-${reference.matchedBy}`,
        };
      }
    }

    const articleIndexes = selectFacebookPublishedPostArticleIndexes(
      await articles.count().catch(() => 0),
    );

    for (const articleIndex of articleIndexes) {
      const article = articles.nth(articleIndex);
      const articleText = normalizeText(
        await article.innerText().catch(() => ""),
      ).toLocaleLowerCase();

      if (!articleText.includes(normalizedFingerprint)) {
        continue;
      }

      const hrefs = await article
        .locator("a[href]")
        .evaluateAll((anchors) =>
          anchors
            .map((anchor) => anchor.getAttribute("href"))
            .filter((href): href is string => Boolean(href)),
        )
        .catch(() => []);

      const reference = buildFacebookPublishedPostReference(page.url(), hrefs);

      if (reference) {
        return {
          ...reference,
          matchedBy: `caption-${reference.matchedBy}`,
        };
      }
    }

    // Facebook sometimes renders the published caption in an image link
    // instead of a role=article. Use the caption-bearing link as a fallback
    // so an already published post is not retried as a duplicate.
    const captionLinks = page
      .locator('a[href]')
      .filter({ hasText: fingerprint });
    const captionLinkCount = Math.min(
      await captionLinks.count().catch(() => 0),
      20,
    );

    for (let index = 0; index < captionLinkCount; index += 1) {
      const href = await captionLinks
        .nth(index)
        .getAttribute('href')
        .catch(() => null);

      if (!href) {
        continue;
      }

      const reference = buildFacebookPublishedPostReference(page.url(), [href]);

      if (reference) {
        return {
          ...reference,
          matchedBy: `caption-link-${reference.matchedBy}`,
        };
      }
    }

    const elapsedMs = Date.now() - startedAt;

    if (
      shouldAdvanceFacebookPublishedPostSearch({
        elapsedMs,
        lastScrollElapsedMs,
        scrollCount,
      })
    ) {
      await page
        .evaluate(() => {
          const distance = Math.max(
            Math.floor(window.innerHeight * 0.9),
            700,
          );
          window.scrollBy(0, distance);
        })
        .catch(() => undefined);

      scrollCount += 1;
      lastScrollElapsedMs = elapsedMs;

      await page
        .waitForTimeout(650)
        .catch(() => undefined);

      continue;
    }

    await page.waitForTimeout(250);
  }

  return null;
}
