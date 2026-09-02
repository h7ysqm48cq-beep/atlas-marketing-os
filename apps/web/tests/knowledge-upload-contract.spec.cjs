const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Atlas Web accepts Excel knowledge files before upload", async () => {
  const source = await readFile(
    "apps/web/src/components/knowledge/KnowledgeLibrary.tsx",
    "utf8",
  );

  assert.match(
    source,
    /["']\.xlsx["']/,
    "knowledge upload validation must allow .xlsx files",
  );

  assert.match(
    source,
    /["']\.xls["']/,
    "knowledge upload validation must allow .xls files",
  );

  assert.match(
    source,
    /accept=["'][^"']*\.xlsx[^"']*\.xls[^"']*["']/,
    "file input must advertise .xlsx and .xls support",
  );

  assert.match(
    source,
    /XLSX, XLS/,
    "visible upload guidance must advertise Excel support",
  );
});
