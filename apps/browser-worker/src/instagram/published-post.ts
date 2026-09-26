import type { Page } from 'playwright-core';

export type InstagramPublishedPostReference = {
  externalPostId: string;
  postUrl: string;
  matchedBy?: string;
};

const INSTAGRAM_BASE_URL = 'https://www.instagram.com/';
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function createInstagramCaptionFingerprint(caption: string) {
  return normalizeText(caption).slice(0, 96);
}

export function parseInstagramPublishedPostReference(
  value?: string | null,
): InstagramPublishedPostReference | null {
  const raw = value?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw, INSTAGRAM_BASE_URL);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'instagram.com' && hostname !== 'www.instagram.com') {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const [kind, shortcode] = segments;
  if ((kind !== 'p' && kind !== 'reel') || !SHORTCODE_PATTERN.test(shortcode)) {
    return null;
  }

  return {
    externalPostId: shortcode,
    postUrl: `${INSTAGRAM_BASE_URL}${kind}/${shortcode}/`,
  };
}

async function resolveExplicitPostReference(page: Page) {
  const current = parseInstagramPublishedPostReference(page.url());
  if (current) return { ...current, matchedBy: 'current-url' };

  const explicitPostLinks = page.getByRole('link', {
    name: /^(?:view|see) post$/i,
  });
  const count = Math.min(await explicitPostLinks.count().catch(() => 0), 5);

  for (let index = 0; index < count; index += 1) {
    const link = explicitPostLinks.nth(index);
    if (!(await link.isVisible().catch(() => false))) continue;
    const reference = parseInstagramPublishedPostReference(
      await link.getAttribute('href').catch(() => null),
    );
    if (reference) return { ...reference, matchedBy: 'explicit-post-link' };
  }

  return null;
}

export async function resolveInstagramPublishedPostReference(
  page: Page,
  timeoutMs = 0,
  pollIntervalMs = 250,
): Promise<InstagramPublishedPostReference | null> {
  const startedAt = Date.now();

  do {
    const reference = await resolveExplicitPostReference(page);
    if (reference) return reference;
    if (Date.now() - startedAt >= timeoutMs) break;
    await page.waitForTimeout(pollIntervalMs).catch(() => undefined);
  } while (true);

  return null;
}

export async function findInstagramPublishedPostReference(
  page: Page,
  caption: string,
  profileUsername: string,
  timeoutMs = 15000,
): Promise<InstagramPublishedPostReference | null> {
  const username = profileUsername.trim();
  const fingerprint = createInstagramCaptionFingerprint(caption);

  if (!USERNAME_PATTERN.test(username) || fingerprint.length < 24) {
    return null;
  }

  const profileUrl = `${INSTAGRAM_BASE_URL}${username}/`;
  const startedAt = Date.now();
  const inspected = new Set<string>();

  const openProfile = async () => {
    await page.goto(profileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    }).catch(() => undefined);
    await page.waitForTimeout(750).catch(() => undefined);

    const profileText = normalizeText(
      await page.locator('body').innerText().catch(() => ''),
    );
    return (
      profileText.includes(username.toLowerCase()) &&
      /\b(edit profile|view archive)\b/i.test(profileText)
    );
  };

  if (!(await openProfile())) return null;

  while (Date.now() - startedAt < timeoutMs) {
    const hrefs = await page
      .locator('a[href*="/p/"], a[href*="/reel/"]')
      .evaluateAll((anchors) =>
        anchors
          .map((anchor) => anchor.getAttribute('href'))
          .filter((href): href is string => Boolean(href)),
      )
      .catch(() => []);

    for (const href of hrefs.slice(0, 12)) {
      const reference = parseInstagramPublishedPostReference(href);
      if (!reference || inspected.has(reference.postUrl)) continue;
      inspected.add(reference.postUrl);

      await page.goto(reference.postUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => undefined);

      const postText = normalizeText(
        await page.locator('body').innerText().catch(() => ''),
      );

      if (postText.includes(fingerprint)) {
        return {
          ...reference,
          matchedBy: 'caption-profile-post',
        };
      }
    }

    if (!(await openProfile())) return null;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2))
      .catch(() => undefined);
    await page.waitForTimeout(750).catch(() => undefined);
  }

  return null;
}
