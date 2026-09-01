import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const engineeringCopilotSource = readFileSync(
  resolve(
    __dirname,
    "../src/components/engineering/EngineeringCopilot.tsx",
  ),
  "utf8",
);

for (const fakePreviewText of [
  "- Current implementation",
  "+ Updated implementation based on plan",
  "// Review required before applying",
]) {
  assert.equal(
    engineeringCopilotSource.includes(fakePreviewText),
    false,
    `synthetic diff text must not be rendered: ${fakePreviewText}`,
  );
}

assert.equal(
  engineeringCopilotSource.includes(
    "runtime.patches =\n              patchData.patches || [];",
  ),
  false,
  "raw patch preparation records must not be exposed as executable patches",
);

assert.match(
  engineeringCopilotSource,
  /patch\.before\s*!==\s*patch\.after/u,
  "EngineeringCopilot must keep only patches with a real source delta",
);
