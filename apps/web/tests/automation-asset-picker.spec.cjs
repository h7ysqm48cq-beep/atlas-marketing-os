const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Automation Browser Draft can select a saved image asset and send its remote URL", async () => {
  const source = await readFile(
    "apps/web/src/components/automation/AutomationDashboard.tsx",
    "utf8",
  );

  assert.match(
    source,
    /type BrowserDraftAsset = \{[\s\S]*id: string;[\s\S]*name: string;[\s\S]*url: string;[\s\S]*type: "IMAGE"/,
    "Automation must model saved image assets explicitly",
  );

  assert.match(
    source,
    /assets\?view=library/,
    "Automation must load Asset Library entries",
  );

  assert.match(
    source,
    /setBrowserDraftAssets\([\s\S]*filter\(\(asset\) => asset\.type === "IMAGE"/,
    "Only image assets should be offered to Browser Draft",
  );

  assert.match(
    source,
    /value=\{selectedBrowserAssetId\}/,
    "Browser Draft must expose the selected saved asset",
  );

  assert.match(
    source,
    /setSelectedBrowserAssetId\(event\.target\.value\)/,
    "Asset selection must be persisted in component state",
  );

  assert.match(
    source,
    /selectedBrowserAsset\?\.url[\s\S]*imageUrl: selectedBrowserAsset\.url/,
    "prepare-post must send the selected Asset URL as imageUrl",
  );

  assert.match(
    source,
    /imagePath: browserImagePath\.trim\(\) \|\| null/,
    "existing local-path fallback must remain available",
  );
});
