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
