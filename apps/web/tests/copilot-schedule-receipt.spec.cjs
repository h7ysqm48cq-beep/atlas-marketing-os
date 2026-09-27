const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Copilot keeps a traceable ScheduledPost receipt and links to Calendar", async () => {
  const source = await readFile("apps/web/src/components/BrandCopilot.tsx", "utf8");

  assert.match(source, /type ScheduleReceipt = \{[\s\S]*postCount: number;[\s\S]*postId: string;[\s\S]*date: string;/);
  assert.match(source, /const \[scheduleReceipt, setScheduleReceipt\] = useState<ScheduleReceipt \| null>/);
  assert.match(source, /const result = await scheduleWorkspaceAction\(/);
  assert.match(source, /result\.scheduledItems\?\.\[0\][\s\S]*posts\?\.\[0\]/);
  assert.match(source, /setScheduleReceipt\([\s\S]*postCount: result\.postCount[\s\S]*postId: firstPost\.id[\s\S]*date: scheduleDate/);
  assert.match(
    source,
    /\/calendar\?date=[\s\S]{0,160}scheduleReceipt\.date[\s\S]{0,160}postId=[\s\S]{0,160}scheduleReceipt\.postId/,
  );
});
