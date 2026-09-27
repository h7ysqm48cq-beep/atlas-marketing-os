const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Copilot Schedule uses a product dialog instead of date/time prompts", async () => {
  const source = await readFile(
    "apps/web/src/components/BrandCopilot.tsx",
    "utf8",
  );

  const scheduleStart = source.indexOf("async function scheduleCurrentStudioResult");
  const scheduleEnd = source.indexOf("function updateMessageStudioResult", scheduleStart);
  const scheduleBlock = source.slice(scheduleStart, scheduleEnd);

  assert.ok(scheduleStart > 0 && scheduleEnd > scheduleStart);
  assert.doesNotMatch(scheduleBlock, /window\.prompt/);

  assert.match(source, /scheduleDialogOpen/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-label="Schedule content"/);
  assert.match(source, /type="date"/);
  assert.match(source, /type="time"/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /scheduleChannelIds/);
  assert.match(source, /scheduleWorkspaceAction\([\s\S]*scheduleChannelIds/);
  assert.match(source, /setScheduleDialogOpen\(false\)/);
});
