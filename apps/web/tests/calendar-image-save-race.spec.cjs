const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);

  assert.notEqual(
    start,
    -1,
    `Unable to find ${startMarker}`,
  );

  const end = source.indexOf(
    endMarker,
    start + startMarker.length,
  );

  assert.notEqual(
    end,
    -1,
    `Unable to find ${endMarker}`,
  );

  return source.slice(start, end);
}

test(
  "Calendar cannot save while a device image is still uploading",
  async () => {
    const source = await readFile(
      "apps/web/src/components/calendar/ContentCalendar.tsx",
      "utf8",
    );

    const createPost = extractFunction(
      source,
      "async function createPost()",
      "function openEditPost(",
    );

    assert.match(
      createPost,
      /if\s*\(\s*uploadingImage\s*\)/,
      "createPost must fail closed while image upload is pending",
    );

    const guardIndex = createPost.indexOf(
      "if (uploadingImage)",
    );

    const savingIndex = createPost.indexOf(
      "setSaving(true)",
    );

    assert.ok(
      guardIndex >= 0 &&
        savingIndex >= 0 &&
        guardIndex < savingIndex,
      "upload guard must run before Save begins",
    );

    const clickMarker =
      'onClick={() => void createPost()}';

    const clickIndex = source.indexOf(clickMarker);

    assert.notEqual(
      clickIndex,
      -1,
      "Unable to find Calendar Save button",
    );

    const saveButton = source.slice(
      Math.max(0, clickIndex - 120),
      clickIndex + 500,
    );

    assert.match(
      saveButton,
      /disabled=\{[\s\S]{0,250}uploadingImage/,
      "Save button must stay disabled until image upload completes",
    );
  },
);
