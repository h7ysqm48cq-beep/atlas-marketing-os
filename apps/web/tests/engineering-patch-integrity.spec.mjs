import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  canApproveEngineeringPlan,
  getActionablePatches,
} from "../src/components/engineering/engineering-patch-integrity.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const noOpPatch = {
  filePath: "apps/web/src/example.tsx",
  action: "modify",
  before: "const value = 1;",
  after: "const value = 1;",
  explanation: "analysis only",
};

const realPatch = {
  filePath: "apps/web/src/example.tsx",
  action: "modify",
  before: "const value = 1;",
  after: "const value = 2;",
  explanation: "real source delta",
};

assert.deepEqual(
  getActionablePatches([noOpPatch]),
  [],
  "no-op preparation records must not be treated as executable patches",
);

assert.deepEqual(
  getActionablePatches([noOpPatch, realPatch]),
  [realPatch],
  "only patches with a real source delta are actionable",
);

assert.equal(
  canApproveEngineeringPlan(
    { executable: false },
    [realPatch],
  ),
  false,
  "analysis-only plans must never be approvable",
);

assert.equal(
  canApproveEngineeringPlan(
    { executable: true },
    [noOpPatch],
  ),
  false,
  "executable plans still require at least one real patch delta",
);

assert.equal(
  canApproveEngineeringPlan(
    { executable: true },
    [realPatch],
  ),
  true,
  "an executable plan with a real patch delta can proceed to approval",
);

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

assert.match(
  engineeringCopilotSource,
  /getActionablePatches\(/u,
  "EngineeringCopilot must filter patch API results before exposing them as proposed patches",
);

assert.match(
  engineeringCopilotSource,
  /canApproveEngineeringPlan\(/u,
  "EngineeringCopilot must gate approval using plan executable state and real patch deltas",
);
