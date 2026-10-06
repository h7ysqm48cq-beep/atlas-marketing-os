import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = ".github/workflows/atlas-authorized-merge.yml";

test("authorized merge failure redrafts the exact still-open governed candidate", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /pull-requests:\s*write/);
  assert.match(source, /async function redraftOpenCandidateAfterFailure\(/);
  assert.match(source, /convertPullRequestToDraft/);
  assert.match(source, /EVENT_NAME\s*!==\s*['"]workflow_run['"]/);
  assert.match(source, /current\?\.state\s*!==\s*['"]open['"]/);
  assert.match(source, /current\?\.merged\s*===\s*true/);
  assert.match(source, /current\?\.draft\s*===\s*true/);
  assert.match(source, /current\?\.head\?\.sha\s*!==\s*context\.headSha/);
  assert.match(source, /await redraftOpenCandidateAfterFailure\(\)/);
});

test("redraft is armed only after exact open-candidate identity is known", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(
    source,
    /mergeFailureContext\s*=\s*\{[\s\S]{0,500}prNumber:\s*PR_NUMBER[\s\S]{0,500}headSha:\s*HEAD_SHA/,
  );
  assert.match(source, /baseRef:\s*pr\.base\.ref/);
  assert.match(source, /baseSha:\s*pr\.base\.sha/);
});
