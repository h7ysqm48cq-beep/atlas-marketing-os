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

test("workflow GITHUB_TOKEN has no repository contents write permission", async () => {
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
    assert.equal(
      contentsPermissions[0],
      "read",
      `${name} must keep the workflow GITHUB_TOKEN repository-read-only`,
    );
    assert.doesNotMatch(
      source,
      /^\s+contents:\s*write\s*$/mu,
      `${name} must not grant workflow-level contents: write at any scope`,
    );
  }
});

test("authorized branch write is isolated to an exact-repository GitHub App installation token", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ATLAS_TRUSTED_MERGE_APP_ID/);
  assert.match(source, /ATLAS_TRUSTED_MERGE_INSTALLATION_ID/);
  assert.match(source, /ATLAS_TRUSTED_MERGE_PRIVATE_KEY/);
  assert.match(source, /async function createTrustedMergeInstallationToken\(/);
  assert.match(source, /\/app\/installations\/\$\{TRUSTED_MERGE_INSTALLATION_ID\}\/access_tokens/);
  assert.match(source, /repositories:\s*\[repositoryName\]/);
  assert.match(source, /permissions:\s*\{\s*contents:\s*['"]write['"]\s*\}/);
  assert.match(source, /tokenRepositories\.length\s*!==\s*1/);
  assert.match(source, /tokenRepositories\[0\]\s*!==\s*REPOSITORY/);
  assert.match(source, /async function trustedMergePullRequest\(/);
  assert.match(source, /Authorization:\s*`Bearer \$\{installationToken\}`/);
  assert.match(source, /await trustedMergePullRequest\([\s\S]{0,120}PR_NUMBER[\s\S]{0,120}HEAD_SHA/);
  assert.doesNotMatch(
    source,
    /await github\(\s*`\/pulls\/\$\{PR_NUMBER\}\/merge`/,
  );
});
