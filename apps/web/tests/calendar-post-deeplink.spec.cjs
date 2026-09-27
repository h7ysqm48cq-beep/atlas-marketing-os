const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Calendar deep-link opens the scheduled post receipt", async () => {
  const source = await readFile("apps/web/src/components/calendar/ContentCalendar.tsx", "utf8");

  assert.match(source, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(source, /searchParams\.get\("date"\)/);
  assert.match(source, /searchParams\.get\("postId"\)/);
  assert.match(source, /setCurrentMonth\(new Date\(year, month - 1, 1\)\)/);
  assert.match(source, /posts\.find\(\(post\) => post\.id === targetPostId\)/);
  assert.match(source, /setSelectedPost\(matchedPost\)/);
});
