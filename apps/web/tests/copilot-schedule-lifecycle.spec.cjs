const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../src/components/BrandCopilot.tsx"),
  "utf8",
);

test("Copilot keeps the exact scheduled post lifecycle visible", () => {
  assert.match(source, /status: ScheduleLifecycleStatus;/);
  assert.match(
    source,
    /API_URL \+ "\/automation\/posts\/" \+ encodeURIComponent\(postId\)/,
  );
  assert.match(source, /\{ cache: "no-store" \}/);
  assert.match(source, /"PUBLISHED"/);
  assert.match(source, /"FAILED"/);
  assert.match(source, /"CANCELLED"/);
  assert.match(source, /clearTimeout\(timeoutId\)/);
  assert.match(source, /status: "SCHEDULED"/);
  assert.match(source, /lastError: post\.lastError \?\? null/);
  assert.match(source, /externalPostUrl: post\.externalPostUrl \?\? null/);
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /url\.protocol !== "http:"/);
  assert.match(
    source,
    /Post status: \{scheduleLifecycleLabel\(scheduleReceipt\.status\)\}/,
  );
  assert.match(source, /scheduleReceipt\.status === "PUBLISHED"/);
  assert.match(source, /Open published post/);
  assert.match(source, /scheduleReceipt\.status === "FAILED"/);
  assert.match(source, /Publish failed:/);
  assert.match(source, /scheduleFailureMessage\(scheduleReceipt\.lastError\)/);
  assert.match(source, /View in Calendar/);
});
