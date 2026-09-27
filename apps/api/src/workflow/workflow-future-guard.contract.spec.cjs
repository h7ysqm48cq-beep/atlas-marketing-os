const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("workflow autoQueue rejects a planned first schedule that is not in the future", async () => {
  const source = await readFile(
    "apps/api/src/workflow/workflow.service.ts",
    "utf8",
  );

  assert.match(
    source,
    /schedules\[0\][\s\S]{0,200}scheduledAtUtc\.getTime\(\) <= Date\.now\(\)/,
    "autoQueue must fail closed when its first planned schedule is past or current",
  );

  assert.match(
    source,
    /Scheduled time must be in the future\./,
    "API must expose a deterministic future-time validation error",
  );
});
