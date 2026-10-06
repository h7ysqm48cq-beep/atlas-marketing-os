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


test("only trusted authorized merge may write repository contents", async () => {
  const { readdir } = await import("node:fs/promises");
  const workflowDir = ".github/workflows";
  const names = (await readdir(workflowDir))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort();

  assert.ok(names.length > 0);

  for (const name of names) {
    const source = await readFile(`${workflowDir}/${name}`, "utf8");
    const contentsPermissions = [
      ...source.matchAll(/^\s{2}contents:\s*(read|write)\s*$/gmu),
    ].map((match) => match[1]);

    assert.equal(
      contentsPermissions.length,
      1,
      `${name} must declare exactly one top-level contents permission`,
    );

    const expected =
      name === "atlas-authorized-merge.yml"
        ? "write"
        : "read";

    assert.equal(
      contentsPermissions[0],
      expected,
      `${name} has unexpected repository contents permission`,
    );

    if (name !== "atlas-authorized-merge.yml") {
      assert.doesNotMatch(
        source,
        /^\s+contents:\s*write\s*$/mu,
        `${name} must not grant contents: write at any scope`,
      );
    }
  }
});
