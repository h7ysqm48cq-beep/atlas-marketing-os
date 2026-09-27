const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("AI schedule actions preserve the active image Asset context", async () => {
  const source = await readFile(
    "apps/web/src/components/BrandCopilot.tsx",
    "utf8",
  );

  assert.match(
    source,
    /const workspaceAssetId =[\s\S]*currentAttachments[\s\S]*kind === "image"[\s\S]*assetId[\s\S]*messages[\s\S]*role === "assistant"[\s\S]*message\.assetId/,
    "AI requests must resolve an explicit or recent assistant image Asset",
  );

  assert.match(
    source,
    /assetIds:\s*workspaceAssetId\s*\?\s*\[workspaceAssetId\]\s*:\s*undefined/,
    "resolved Asset identity must be included in workspaceContext",
  );

  assert.match(
    source,
    /applyWorkspaceAction\([\s\S]{0,120}parsedReply\.action[\s\S]{0,120}executionDraft[\s\S]{0,120}workspaceAssetId/,
    "AI workspace actions must receive the resolved Asset identity",
  );

  assert.match(
    source,
    /async function applyWorkspaceAction\([\s\S]{0,180}assetId\?: string/,
    "workspace action execution must accept Asset context",
  );

  assert.match(
    source,
    /openScheduleDialog\([\s\S]{0,120}draftSnapshot,[\s\S]{0,80}assetId,[\s\S]{0,80}item/,
    "AI schedule review must preserve the Asset identity",
  );
});
