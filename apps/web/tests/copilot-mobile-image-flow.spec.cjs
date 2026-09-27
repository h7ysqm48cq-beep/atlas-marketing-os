const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("BrandCopilot keeps uploaded image asset IDs and exposes edit/camera/gallery flow", async () => {
  const source = await readFile(
    "apps/web/src/components/BrandCopilot.tsx",
    "utf8",
  );

  assert.match(source, /assetId\?: string;/);
  assert.match(source, /attachment\.assetId/);
  assert.match(source, /attachmentCameraInputRef/);
  assert.match(source, /attachmentGalleryInputRef/);
  assert.match(
    source,
    /capture=["']environment["']/,
    "camera input must request the rear/environment camera",
  );
  assert.match(source, /Camera/);
  assert.match(source, /Gallery/);
  assert.match(
    source,
    /\/image-editor\?/,
    "asset-backed uploaded images must be able to open Image Editor",
  );
});

test("Image Editor exposes independent camera and gallery upload inputs", async () => {
  const source = await readFile(
    "apps/web/src/components/ImageBrandEditor.tsx",
    "utf8",
  );

  assert.match(
    source,
    /capture=["']environment["']/,
    "Image Editor camera input must request the rear/environment camera",
  );
  assert.match(source, /Camera/);
  assert.match(source, /Gallery/);
  assert.match(source, /uploadOwnImage/);
});
