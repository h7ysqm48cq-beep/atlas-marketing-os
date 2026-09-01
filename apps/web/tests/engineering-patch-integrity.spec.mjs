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

function sourceSection(startMarker, endMarker) {
  const start = engineeringCopilotSource.indexOf(startMarker);
  const end = engineeringCopilotSource.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);

  return engineeringCopilotSource.slice(start, end);
}

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

const executionGateSource = sourceSection(
  "  const plan =",
  "  const actions = useMemo",
);

assert.match(
  executionGateSource,
  /plan\?\.executable/u,
  "execution gate must require an executable engineering plan",
);
assert.match(
  executionGateSource,
  /proposal/u,
  "execution gate must require a persisted patch proposal",
);
assert.match(
  executionGateSource,
  /runtimeView\.patches\?\.some/u,
  "execution gate must require at least one prepared patch",
);
assert.match(
  executionGateSource,
  /patch\.before\s*!==\s*patch\.after/u,
  "execution gate must independently verify a real source delta",
);

const actionsSource = sourceSection(
  "  const actions = useMemo",
  "  async function analyseRequest",
);

assert.match(
  actionsSource,
  /!hasExecutablePatch/u,
  "Approve and Apply actions must be disabled when no executable patch exists",
);

const approveSource = sourceSection(
  "    if (actionId === \"approve\")",
  "    if (actionId === \"apply\")",
);

assert.match(
  approveSource,
  /!hasExecutablePatch\s*\|\|\s*!proposal/u,
  "approve handler must fail closed without both an executable patch and persisted proposal",
);

const applySource = sourceSection(
  "    if (actionId === \"apply\")",
  "    if (actionId === \"reject\")",
);

assert.match(
  applySource,
  /!hasExecutablePatch\s*\|\|\s*!proposal/u,
  "apply handler must fail closed without both an executable patch and persisted proposal",
);

assert.equal(
  engineeringCopilotSource.includes("/engineering/apply/batch"),
  false,
  "EngineeringCopilot must not call the raw client-controlled batch apply endpoint",
);

assert.match(
  engineeringCopilotSource,
  /\/engineering\/apply\/proposal/u,
  "EngineeringCopilot must apply only a persisted patch proposal",
);

assert.match(
  engineeringCopilotSource,
  /proposalId/u,
  "proposal-bound apply must send the immutable proposal id",
);

assert.match(
  engineeringCopilotSource,
  /revision/u,
  "proposal-bound apply must send the reviewed proposal revision",
);
