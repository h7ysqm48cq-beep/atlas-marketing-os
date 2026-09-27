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
  assert.match(
    source,
    /Post status: \{scheduleLifecycleLabel\(scheduleReceipt\.status\)\}/,
  );
  assert.match(source, /View in Calendar/);
});
