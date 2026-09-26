import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
  });
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
