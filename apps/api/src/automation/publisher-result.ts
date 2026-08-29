type PublishResult =
  | {
      postId?: unknown;
      post_id?: unknown;
      id?: unknown;
      messageId?: unknown;
      message_id?: unknown;
      postUrl?: unknown;
      post_url?: unknown;
    }
  | null
  | undefined;

function cleanString(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const clean = value.toString().trim();

  return clean || null;
}

export function resolvePublishExternalId(result: PublishResult) {
  return cleanString(
    result?.postId ??
      result?.post_id ??
      result?.id ??
      result?.messageId ??
      result?.message_id,
  );
}

export function buildFacebookPostUrl(externalPostId?: string | null) {
  const cleanId = externalPostId?.trim();

  if (!cleanId) {
    return null;
  }

  const separatorIndex = cleanId.indexOf('_');

  if (separatorIndex < 0) {
    return null;
  }

  const pageId = cleanId.slice(0, separatorIndex);
  const postId = cleanId.slice(separatorIndex + 1);

  if (!pageId || !postId) {
    return null;
  }

  return `https://www.facebook.com/${pageId}/posts/${postId}`;
}

export function resolveFacebookPostUrl(
  result: PublishResult,
  externalPostId?: string | null,
) {
  return (
    cleanString(result?.postUrl ?? result?.post_url) ||
    buildFacebookPostUrl(externalPostId)
  );
}
