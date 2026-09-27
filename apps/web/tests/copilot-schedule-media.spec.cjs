const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Copilot scheduling carries the current image Asset into workflow mediaUrls", async () => {
  const source = await readFile(
    "apps/web/src/components/BrandCopilot.tsx",
    "utf8",
  );

  assert.match(
    source,
    /async function resolveScheduleMediaUrls\([\s\S]*assetId[\s\S]*platforms/,
    "Copilot must resolve schedule media from the current Asset",
  );

  assert.match(
    source,
    /assets\/\$\{encodeURIComponent\(assetId\)\}/,
    "schedule media resolution must use the existing Asset read endpoint",
  );

  assert.match(
    source,
    /asset\.type !== "IMAGE"[\s\S]*!asset\.url/,
    "only a persisted image Asset with a URL may become scheduled media",
  );
  assert.match(
    source,
    /resolveScheduleMediaUrls\([\s\S]*assetId[\s\S]*action\.platforms/,
    "scheduleWorkspaceAction must resolve media for the requested platforms",
  );

  assert.match(
    source,
    /contents,[\s\S]*mediaUrls,/,
    "auto-queue item must include mediaUrls",
  );

  assert.match(
    source,
    /scheduleCurrentStudioResult\([\s\S]{0,120}message\.studioResult![\s\S]{0,120}message\.assetId/,
    "message scheduling must preserve the message Asset identity",
  );
});
