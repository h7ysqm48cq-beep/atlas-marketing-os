import type { Page } from 'playwright-core';

export type InstagramPublishedPostReference = {
  externalPostId: string;
  postUrl: string;
};

const INSTAGRAM_BASE_URL = 'https://www.instagram.com/';
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]+$/;

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

export async function resolveInstagramPublishedPostReference(
  page: Page,
): Promise<InstagramPublishedPostReference | null> {
  const current = parseInstagramPublishedPostReference(page.url());
  if (current) return current;

  // Deliberately inspect only an explicit post-publish action. Scanning all
  // /p/ or /reel/ links on the home feed could bind the publication receipt
  // to an unrelated existing post.
  const explicitPostLinks = page.getByRole('link', {
    name: /^(?:view|see) post$/i,
  });
  const count = Math.min(
    await explicitPostLinks.count().catch(() => 0),
    5,
  );

  for (let index = 0; index < count; index += 1) {
    const link = explicitPostLinks.nth(index);
    if (!(await link.isVisible().catch(() => false))) continue;
    const reference = parseInstagramPublishedPostReference(
      await link.getAttribute('href').catch(() => null),
    );
    if (reference) return reference;
  }

  return null;
}
