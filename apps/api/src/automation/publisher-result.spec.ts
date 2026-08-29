import {
  resolveFacebookPostUrl,
  resolvePublishExternalId,
} from './publisher-result';

describe('publisher result references', () => {
  it('uses the browser worker Facebook post reference', () => {
    const result = {
      postId: '61592884960509_122112144501429498',
      postUrl:
        'https://www.facebook.com/permalink.php?story_fbid=122112144501429498&id=61592884960509',
    };
    const externalPostId = resolvePublishExternalId(result);

    expect(externalPostId).toBe('61592884960509_122112144501429498');
    expect(resolveFacebookPostUrl(result, externalPostId)).toBe(result.postUrl);
  });

  it('keeps the existing native Facebook id fallback', () => {
    const result = {
      id: '123_456',
    };
    const externalPostId = resolvePublishExternalId(result);

    expect(resolveFacebookPostUrl(result, externalPostId)).toBe(
      'https://www.facebook.com/123/posts/456',
    );
  });
});
