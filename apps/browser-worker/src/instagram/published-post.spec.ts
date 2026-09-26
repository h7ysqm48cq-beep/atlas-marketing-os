import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInstagramCaptionFingerprint,
  findInstagramPublishedPostReference,
  parseInstagramPublishedPostReference,
  resolveInstagramPublishedPostReference,
} from './published-post.js';

test('parses canonical Instagram post and reel permalinks', () => {
  assert.deepEqual(
    parseInstagramPublishedPostReference('https://www.instagram.com/p/AbC_123-x/?utm_source=ig_web_copy_link'),
    {
      externalPostId: 'AbC_123-x',
      postUrl: 'https://www.instagram.com/p/AbC_123-x/',
    },
  );
  assert.deepEqual(
    parseInstagramPublishedPostReference('/reel/ZXy-987_/'),
    {
      externalPostId: 'ZXy-987_',
      postUrl: 'https://www.instagram.com/reel/ZXy-987_/',
    },
  );
});

test('rejects unrelated or untrusted Instagram URLs', () => {
  for (const value of [
    'https://www.instagram.com/',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/p/',
    'https://example.com/p/abc123/',
    'https://instagram.example.com/p/abc123/',
  ]) {
    assert.equal(parseInstagramPublishedPostReference(value), null, value);
  }
});

test('prefers the current page URL when it is already the published post', async () => {
  const page = {
    url: () => 'https://www.instagram.com/p/Current123/',
    getByRole: () => {
      throw new Error('explicit link lookup should not be needed');
    },
  } as never;

  assert.deepEqual(await resolveInstagramPublishedPostReference(page), {
    externalPostId: 'Current123',
    postUrl: 'https://www.instagram.com/p/Current123/',
    matchedBy: 'current-url',
  });
});

test('accepts only an explicit visible View post or See post link', async () => {
  const links = [
    { visible: false, href: '/p/HiddenOld/' },
    { visible: true, href: '/p/NewProof123/' },
  ];
  const page = {
    url: () => 'https://www.instagram.com/',
    getByRole: (_role: string, options: { name: RegExp }) => {
      assert.match('View post', options.name);
      return {
        count: async () => links.length,
        nth: (index: number) => ({
          isVisible: async () => links[index]?.visible ?? false,
          getAttribute: async () => links[index]?.href ?? null,
        }),
      };
    },
  } as never;

  assert.deepEqual(await resolveInstagramPublishedPostReference(page), {
    externalPostId: 'NewProof123',
    postUrl: 'https://www.instagram.com/p/NewProof123/',
    matchedBy: 'explicit-post-link',
  });
});

test('retries explicit proof while Instagram finishes the share transition', async () => {
  let checks = 0;
  const page = {
    url: () => 'https://www.instagram.com/',
    getByRole: () => ({
      count: async () => {
        checks += 1;
        return checks >= 2 ? 1 : 0;
      },
      nth: () => ({
        isVisible: async () => true,
        getAttribute: async () => '/p/DelayedProof123/',
      }),
    }),
    waitForTimeout: async () => undefined,
  } as never;

  const reference = await resolveInstagramPublishedPostReference(page, 1000, 1);
  assert.equal(reference?.externalPostId, 'DelayedProof123');
});

test('does not fabricate proof when no explicit publication reference exists', async () => {
  const page = {
    url: () => 'https://www.instagram.com/',
    getByRole: () => ({
      count: async () => 0,
      nth: () => {
        throw new Error('should not inspect generic feed links');
      },
    }),
  } as never;

  assert.equal(await resolveInstagramPublishedPostReference(page), null);
});

test('creates a stable normalized caption fingerprint', () => {
  assert.equal(
    createInstagramCaptionFingerprint('  Consistency  is\nrarely dramatic.  '),
    'consistency is rarely dramatic.',
  );
});

test('reconciliation requires own-profile proof and matching caption text', async () => {
  let currentUrl = 'https://www.instagram.com/';
  const bodies = new Map([
    ['https://www.instagram.com/empowermindsmuse/', 'empowermindsmuse Edit profile View archive'],
    ['https://www.instagram.com/p/OldWrong/', 'A completely different old caption'],
    ['https://www.instagram.com/p/NewProof123/', 'Consistency is rarely dramatic. It is the quiet repetition of small actions that slowly becomes direction.'],
  ]);
  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      currentUrl = url;
    },
    locator: (selector: string) => {
      if (selector === 'body') {
        return {
          innerText: async () => bodies.get(currentUrl) ?? '',
        };
      }
      return {
        evaluateAll: async () => [
          '/p/OldWrong/',
          '/p/NewProof123/',
        ],
      };
    },
    evaluate: async () => undefined,
    waitForTimeout: async () => undefined,
  } as never;

  assert.deepEqual(
    await findInstagramPublishedPostReference(
      page,
      'Consistency is rarely dramatic. It is the quiet repetition of small actions that slowly becomes direction.',
      'empowermindsmuse',
      1000,
    ),
    {
      externalPostId: 'NewProof123',
      postUrl: 'https://www.instagram.com/p/NewProof123/',
      matchedBy: 'caption-profile-post',
    },
  );
});

test('reconciliation fails closed outside the authenticated own profile', async () => {
  const page = {
    goto: async () => undefined,
    locator: (selector: string) =>
      selector === 'body'
        ? { innerText: async () => 'empowermindsmuse Follow Message' }
        : { evaluateAll: async () => ['/p/ShouldNotTrust/'] },
    evaluate: async () => undefined,
    waitForTimeout: async () => undefined,
  } as never;

  assert.equal(
    await findInstagramPublishedPostReference(
      page,
      'Consistency is rarely dramatic. It is the quiet repetition of small actions that slowly becomes direction.',
      'empowermindsmuse',
      1000,
    ),
    null,
  );
});


test('reconciliation preserves lazy-grid state after scrolling instead of reloading the profile', async () => {
  let currentUrl = 'https://www.instagram.com/';
  let profileScrollLoaded = false;
  const profileUrl = 'https://www.instagram.com/empowermindsmuse/';
  const postUrl = 'https://www.instagram.com/p/LazyProof123/';

  const page = {
    goto: async (url: string) => {
      currentUrl = url;
      if (url === profileUrl) {
        profileScrollLoaded = false;
      }
    },
    locator: (selector: string) => {
      if (selector === 'body') {
        return {
          innerText: async () =>
            currentUrl === profileUrl
              ? 'empowermindsmuse Edit profile View archive'
              : currentUrl === postUrl
                ? 'Consistency is rarely dramatic. It is the quiet repetition of small actions that slowly becomes direction.'
                : '',
        };
      }
      return {
        evaluateAll: async () =>
          currentUrl === profileUrl && profileScrollLoaded
            ? ['/p/LazyProof123/']
            : [],
      };
    },
    evaluate: async () => {
      if (currentUrl === profileUrl) {
        profileScrollLoaded = true;
      }
    },
    waitForTimeout: async () => undefined,
  } as never;

  assert.deepEqual(
    await findInstagramPublishedPostReference(
      page,
      'Consistency is rarely dramatic. It is the quiet repetition of small actions that slowly becomes direction.',
      'empowermindsmuse',
      1000,
    ),
    {
      externalPostId: 'LazyProof123',
      postUrl,
      matchedBy: 'caption-profile-post',
    },
  );
});
