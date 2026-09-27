const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("AI workspace schedule actions open the same review dialog instead of scheduling immediately", async () => {
  const source = await readFile(
    "apps/web/src/components/BrandCopilot.tsx",
    "utf8",
  );

  assert.match(
    source,
    /async function openScheduleDialog\([\s\S]*presetAction/,
    "schedule dialog opening must support an AI schedule preset",
  );

  const applyStart = source.indexOf("async function applyWorkspaceAction");
  const applyEnd = source.indexOf("async function", applyStart + 30);
  const applyBlock = source.slice(applyStart, applyEnd > applyStart ? applyEnd : undefined);

  assert.match(
    applyBlock,
    /item\.type === "schedule"[\s\S]*openScheduleDialog\([\s\S]*item/,
    "AI schedule actions must open the review dialog",
  );

  assert.doesNotMatch(
    applyBlock,
    /item\.type === "schedule"[\s\S]{0,600}scheduleWorkspaceAction\(/,
    "AI schedule actions must not bypass review by scheduling immediately",
  );

  assert.match(
    source,
    /presetAction\?\.platforms/,
    "AI requested platforms must prefill the review dialog",
  );

  assert.match(
    source,
    /presetAction\?\.date/,
    "AI requested date must prefill the review dialog",
  );

  assert.match(
    source,
    /presetAction\?\.time/,
    "AI requested time must prefill the review dialog",
  );
});
