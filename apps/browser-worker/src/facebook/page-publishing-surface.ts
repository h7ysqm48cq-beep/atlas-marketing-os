export type FacebookPagePublishingSurfacePage = {
  url: () => string;
  goto: (url: string, options: {
    waitUntil: "domcontentloaded";
    timeout: number;
  }) => Promise<unknown>;
};

export type FacebookPagePublishingSurfaceResult = {
  verified: boolean;
  recovered: boolean;
  reason:
    | "VERIFIED"
    | "BUSINESS_SUITE_SURFACE"
    | "TARGET_PAGE_MISMATCH"
    | "TARGET_PAGE_UNVERIFIABLE";
  finalUrl: string;
};

function inspectSurface(
  value: string,
  targetPageId: string,
): FacebookPagePublishingSurfaceResult["reason"] {
  if (!/^\d+$/.test(targetPageId)) {
    return "TARGET_PAGE_UNVERIFIABLE";
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return "TARGET_PAGE_UNVERIFIABLE";
    }
    if (url.hostname === "business.facebook.com") {
      // asset_id is not evidence of a standard Facebook composer surface.
      return "BUSINESS_SUITE_SURFACE";
    }
    if (url.hostname !== "facebook.com" && url.hostname !== "www.facebook.com") {
      return "TARGET_PAGE_UNVERIFIABLE";
    }

    const ids = url.searchParams.getAll("id");
    const pathId = url.pathname.match(/^\/(\d+)\/?$/)?.[1];
    const pageId = url.pathname === "/profile.php" ? ids[0] : pathId;
    const assetIds = url.searchParams.getAll("asset_id");
    if (
      !pageId || !/^\d+$/.test(pageId) || ids.length > 1 ||
      (pathId && ids.length > 0 && ids[0] !== pathId) ||
      assetIds.length > 1 || (assetIds.length === 1 && assetIds[0] !== pageId) ||
      url.searchParams.getAll("sk").some((tab) => tab !== "posts") ||
      ["story_fbid", "fbid", "modal"].some((key) => url.searchParams.has(key))
    ) {
      return "TARGET_PAGE_UNVERIFIABLE";
    }
    return pageId === targetPageId ? "VERIFIED" : "TARGET_PAGE_MISMATCH";
  } catch {
    return "TARGET_PAGE_UNVERIFIABLE";
  }
}

export async function ensureFacebookPagePublishingSurface(input: {
  page: FacebookPagePublishingSurfacePage;
  targetPageId: string;
  allowRecovery?: boolean;
}): Promise<FacebookPagePublishingSurfaceResult> {
  let finalUrl = input.page.url();
  let reason = inspectSurface(finalUrl, input.targetPageId);
  let recovered = false;

  if (reason === "BUSINESS_SUITE_SURFACE" && input.allowRecovery !== false) {
    recovered = true;
    await input.page.goto(
      `https://www.facebook.com/profile.php?id=${input.targetPageId}`,
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    finalUrl = input.page.url();
    reason = inspectSurface(finalUrl, input.targetPageId);
  }

  return {
    verified: reason === "VERIFIED",
    recovered,
    reason,
    finalUrl,
  };
}
