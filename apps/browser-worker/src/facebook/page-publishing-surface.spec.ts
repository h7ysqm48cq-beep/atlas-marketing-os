import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureFacebookPagePublishingSurface,
  type FacebookPagePublishingSurfacePage,
} from "./page-publishing-surface.js";

const targetPageId = "1292937667230187";
const targetUrl = `https://www.facebook.com/profile.php?id=${targetPageId}`;

function createPage(
  initialUrl: string,
  navigatedUrls: string[],
  recoveryUrl = targetUrl,
): FacebookPagePublishingSurfacePage {
  let currentUrl = initialUrl;

  return {
    url: () => currentUrl,
    goto: async (url: string) => {
      navigatedUrls.push(url);
      currentUrl = url === targetUrl ? recoveryUrl : url;
    },
  };
}

test("accepts the exact requested Facebook Page publishing surface", async () => {
  const navigatedUrls: string[] = [];
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(targetUrl, navigatedUrls),
    targetPageId,
  });

  assert.deepEqual(result, {
    verified: true,
    recovered: false,
    reason: "VERIFIED",
    finalUrl: targetUrl,
  });
  assert.deepEqual(navigatedUrls, []);
});

test("rejects a different Facebook Page", async () => {
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      "https://www.facebook.com/profile.php?id=1152201331300072",
      [],
    ),
    targetPageId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "TARGET_PAGE_MISMATCH");
});

test("does not accept Business Suite Inbox as the standard surface", async () => {
  const navigatedUrls: string[] = [];
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      `https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`,
      navigatedUrls,
    ),
    targetPageId,
  });

  assert.equal(result.recovered, true);
  assert.deepEqual(navigatedUrls, [targetUrl]);
});

test("recovers from Business Suite Inbox exactly once", async () => {
  const navigatedUrls: string[] = [];
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      `https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`,
      navigatedUrls,
    ),
    targetPageId,
  });

  assert.equal(result.verified, true);
  assert.equal(result.recovered, true);
  assert.deepEqual(navigatedUrls, [targetUrl]);
});

test("allows PREPARE after recovery to the exact requested Page", async () => {
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      `https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`,
      [],
      targetUrl,
    ),
    targetPageId,
  });

  assert.equal(result.verified, true);
  assert.equal(result.finalUrl, targetUrl);
});

test("fails closed when recovery remains on Business Suite", async () => {
  const businessSuiteRecoveryUrl =
    `https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`;
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      businessSuiteRecoveryUrl,
      [],
      businessSuiteRecoveryUrl,
    ),
    targetPageId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "BUSINESS_SUITE_SURFACE");
});

test("fails closed when recovery reaches a different Page", async () => {
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      `https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`,
      [],
      "https://www.facebook.com/profile.php?id=1152201331300072",
    ),
    targetPageId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "TARGET_PAGE_MISMATCH");
});

test("fails closed for a personal profile with no requested Page id", async () => {
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(
      "https://www.facebook.com/profile.php?id=61592884960509",
      [],
    ),
    targetPageId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "TARGET_PAGE_MISMATCH");
});

test("fails closed for an ambiguous Facebook URL", async () => {
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage("https://www.facebook.com/", []),
    targetPageId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "TARGET_PAGE_UNVERIFIABLE");
});

for (const url of [
  `https://www.facebook.com/${targetPageId}/photos`,
  `https://www.facebook.com/1152201331300072?id=${targetPageId}`,
  `https://www.facebook.com/profile.php?id=${targetPageId}&id=1152201331300072`,
  `https://www.facebook.com/profile.php?id=${targetPageId}&asset_id=1152201331300072`,
  `https://www.facebook.com/profile.php?id=${targetPageId}&sk=photos`,
  `http://www.facebook.com/profile.php?id=${targetPageId}`,
  `https://user@www.facebook.com/profile.php?id=${targetPageId}`,
  `https://www.facebook.com:8443/profile.php?id=${targetPageId}`,
  `https://www.facebook.com.evil.test/profile.php?id=${targetPageId}`,
  "not a URL",
]) {
  test(`fails closed for unsupported or ambiguous surface: ${url}`, async () => {
    const navigatedUrls: string[] = [];
    const result = await ensureFacebookPagePublishingSurface({
      page: createPage(url, navigatedUrls),
      targetPageId,
    });
    assert.equal(result.verified, false);
    assert.deepEqual(navigatedUrls, []);
  });
}

test("does not recover again after the PREPARE recovery budget is consumed", async () => {
  const navigatedUrls: string[] = [];
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage(`https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`, navigatedUrls),
    targetPageId,
    allowRecovery: false,
  });
  assert.equal(result.verified, false);
  assert.deepEqual(navigatedUrls, []);
});

test("rejects an invalid requested Page id without navigation", async () => {
  const navigatedUrls: string[] = [];
  const result = await ensureFacebookPagePublishingSurface({
    page: createPage("https://business.facebook.com/latest/inbox/all", navigatedUrls),
    targetPageId: "",
  });
  assert.equal(result.verified, false);
  assert.deepEqual(navigatedUrls, []);
});

test("uses a bounded canonical recovery navigation, not network-idle waiting", async () => {
  let currentUrl = `https://business.facebook.com/latest/inbox/all?asset_id=${targetPageId}`;
  let observedOptions: unknown;
  const result = await ensureFacebookPagePublishingSurface({
    page: {
      url: () => currentUrl,
      goto: async (url, options) => {
        observedOptions = options;
        currentUrl = url;
      },
    },
    targetPageId,
  });
  assert.equal(result.verified, true);
  assert.deepEqual(observedOptions, { waitUntil: "domcontentloaded", timeout: 30000 });
});
