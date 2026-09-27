const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Copilot schedule dialog rejects past MYT times before workflow submit", async () => {
  const source = await readFile(
    "apps/web/src/components/BrandCopilot.tsx",
    "utf8",
  );

  assert.match(
    source,
    /new Date\([\s\S]{0,80}scheduleDate[\s\S]{0,80}scheduleTime[\s\S]{0,40}\+08:00/,
    "schedule dialog must construct the selected MYT instant",
  );

  assert.match(
    source,
    /scheduledAt\.getTime\(\) <= Date\.now\(\)/,
    "schedule dialog must reject a selected time that is not in the future",
  );

  assert.match(
    source,
    /Schedule time must be in the future\./,
    "schedule dialog must show an explicit future-time error",
  );
});
