export type FacebookPageCandidate = {
  pageId: string | null;
  name: string;
  url: string;
  imageUrl: string | null;
};

function isComposerUrl(value: string) {
  try {
    const url = new URL(value);

    return url.searchParams.get("modal")?.toLowerCase() === "composer";
  } catch {
    return false;
  }
}

export function filterFacebookPageCandidates(
  candidates: FacebookPageCandidate[],
) {
  return candidates.filter((candidate) => {
    const normalizedName = candidate.name.trim().toLowerCase();

    return (
      normalizedName !== "create post" &&
      !normalizedName.startsWith("unread") &&
      !isComposerUrl(candidate.url)
    );
  });
}
