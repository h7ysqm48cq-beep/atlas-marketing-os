import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CandidateSourceRepository } from "./candidate-source-repository.ts";
import { CandidateWorkspaceManager } from "./candidate-workspace.ts";
import { createEngineeringRunnerOptions } from './bootstrap.ts';
import { EngineeringRunner } from './runner.ts';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function fixture(root: string) {
  const author = path.join(root, "author");
  const remote = path.join(root, "remote.git");
  await mkdir(author);
  await git(author, ["init", "-q"]);
  await git(author, ["config", "user.name", "Atlas Test"]);
  await git(author, ["config", "user.email", "atlas-test@example.invalid"]);
  await writeFile(path.join(author, "app.txt"), "base\n");
  await git(author, ["add", "--", "app.txt"]);
  await git(author, ["commit", "-qm", "base"]);
  await git(author, ["branch", "-M", "production/atlas"]);
  const productionHead = await git(author, ["rev-parse", "HEAD"]);

  await execFileAsync("git", ["init", "--bare", "-q", remote]);
  await git(author, ["push", remote, "HEAD:refs/heads/production/atlas"]);

  return { author, remote, productionHead };
}

test("CandidateSourceRepository initializes a persistent bare mirror and verifies the frozen production base", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "atlas-candidate-source-"));
  try {
    const { remote, productionHead } = await fixture(root);
    const repositoryRoot = path.join(root, "cache", "source.git");
    const source = new CandidateSourceRepository({
      repositoryRoot,
      remote,
    });
    await source.ensureBase(productionHead);
    assert.equal(
      await git(repositoryRoot, ["rev-parse", "--is-bare-repository"]),
      "true",
    );
    assert.equal(
      await git(repositoryRoot, ["rev-parse", productionHead]),
      productionHead,
    );
    assert.equal(
      await git(repositoryRoot, ["rev-parse", "refs/atlas/source/production"]),
      productionHead,
    );

    await source.ensureBase(productionHead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent bare source mirror prepares an exact detached candidate worktree", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "atlas-candidate-source-worktree-"),
  );
  try {
    const { remote, productionHead } = await fixture(root);
    const repositoryRoot = path.join(root, "cache", "source.git");
    const source = new CandidateSourceRepository({
      repositoryRoot,
      remote,
    });
    const manager = new CandidateWorkspaceManager({
      repositoryRoot,
      workspaceRoot: path.join(root, "workspaces"),
      ensureBase: (frozenBaseSha) => source.ensureBase(frozenBaseSha),
    });

    const lease = await manager.prepare({
      taskId: "ATLAS-source-worktree",
      executionId: "ATLAS-EXEC-source-worktree",
      frozenBaseSha: productionHead,
      allowedPaths: ["app.txt"],
    });

    assert.equal(await git(lease.path, ["rev-parse", "HEAD"]), productionHead);
    assert.equal(await git(lease.path, ["branch", "--show-current"]), "");
    assert.deepEqual(await lease.workspace.listChangedFiles(), []);
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CandidateSourceRepository allows anonymous canonical public source transport only", () => {
  assert.throws(
    () =>
      new CandidateSourceRepository({
        repositoryRoot: "/tmp/source.git",
        remote: "https://github.com/example/other.git",
        sourceToken: "source-token",
      }),
    /candidate_source_remote_not_canonical/,
  );
  assert.doesNotThrow(
    () =>
      new CandidateSourceRepository({
        repositoryRoot: "/tmp/source.git",
        remote: "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git",
      }),
  );
  assert.doesNotThrow(
    () =>
      new CandidateSourceRepository({
        repositoryRoot: "/tmp/source.git",
        remote: "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git",
        sourceToken: "source-token",
      }),
  );
});

test("CandidateSourceRepository strips ambient authority and exposes source token only to fetch transport", () => {
  const source = new CandidateSourceRepository({
    repositoryRoot: "/tmp/source.git",
    remote: "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git",
    sourceToken: "source-secret",
    environment: {
      PATH: "/usr/bin",
      HOME: "/sensitive/home",
      SSH_AUTH_SOCK: "/tmp/ssh-agent",
      ATLAS_SUPERVISOR_OWNER_TOKEN: "owner-secret",
    },
  }) as any;
  const baseEnv = source.gitEnvironment(false);
  assert.equal(baseEnv.HOME, undefined);
  assert.equal(baseEnv.SSH_AUTH_SOCK, undefined);
  assert.equal(baseEnv.ATLAS_SUPERVISOR_OWNER_TOKEN, undefined);
  assert.equal(JSON.stringify(baseEnv).includes("source-secret"), false);

  const transportEnv = source.gitEnvironment(true);
  assert.equal(transportEnv.GIT_TERMINAL_PROMPT, "0");
  assert.equal(transportEnv.GIT_CONFIG_KEY_0, "http.extraHeader");
  assert.equal(
    Buffer.from(
      transportEnv.GIT_CONFIG_VALUE_0.replace("Authorization: Basic ", ""),
      "base64",
    ).toString("utf8"),
    "x-access-token:source-secret",
  );
});

test("CandidateSourceRepository rejects repository-local transport rewrites before fetch", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "atlas-candidate-source-config-"),
  );
  try {
    const { remote, productionHead } = await fixture(root);
    const repositoryRoot = path.join(root, "cache.git");
    const source = new CandidateSourceRepository({ repositoryRoot, remote });
    await source.ensureBase(productionHead);
    await git(repositoryRoot, [
      "config",
      "url.https://evil.invalid/.insteadOf",
      "https://github.com/",
    ]);

    await assert.rejects(
      () => source.ensureBase(productionHead),
      /candidate_source_transport_config_unsafe/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CandidateSourceRepository rejects a frozen SHA that is not an ancestor of production", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "atlas-candidate-source-ancestor-"),
  );
  try {
    const { author, remote, productionHead } = await fixture(root);
    await git(author, ["checkout", "-qb", "candidate-only"]);
    await writeFile(path.join(author, "candidate.txt"), "candidate\n");
    await git(author, ["add", "--", "candidate.txt"]);
    await git(author, ["commit", "-qm", "candidate only"]);
    const candidateHead = await git(author, ["rev-parse", "HEAD"]);
    await git(author, ["push", remote, "HEAD:refs/heads/candidate-only"]);
    const repositoryRoot = path.join(root, "cache.git");
    const source = new CandidateSourceRepository({ repositoryRoot, remote });
    await source.ensureBase(productionHead);
    await git(repositoryRoot, [
      "fetch",
      remote,
      "refs/heads/candidate-only:refs/atlas/source/candidate-only",
    ]);

    await assert.rejects(
      () => source.ensureBase(candidateHead),
      /candidate_source_base_not_production_ancestor/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifier fetches EXACT published candidate ref and detached HEAD', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-verifier-candidate-'));
  try {
    const { author, remote, productionHead } = await fixture(root);
    const taskId = 'ATLAS-140-TEST';
    const implementationId = 'ATLAS-EXEC-140-TEST';
    const candidateBranch = 'atlas/candidate/' + taskId + '/' + implementationId;
    await git(author, ['checkout', '-qb', 'local-candidate']);
    await writeFile(path.join(author, 'app.txt'), 'candidate\n');
    await git(author, ['add', '--', 'app.txt']);
    await git(author, ['commit', '-qm', 'candidate']);
    const headSha = await git(author, ['rev-parse', 'HEAD']);
    await git(author, [
      'push', remote, 'HEAD:refs/heads/' + candidateBranch,
    ]);
    const repositoryRoot = path.join(root, 'cache.git');
    const source = new CandidateSourceRepository({ repositoryRoot, remote });
    const frozen = { taskId, implementationId, candidateBranch,
      baseSha: productionHead, headSha };
    await source.ensureCandidate(frozen);
    const manager = new CandidateWorkspaceManager({
      repositoryRoot,
      workspaceRoot: path.join(root, 'worktrees'),
    });
    const lease = await manager.prepare({
      taskId, executionId: 'ATLAS-VERIFIER-140-TEST',
      frozenBaseSha: headSha, allowedPaths: ['app.txt'],
    });
    try {
      assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), headSha);
      assert.equal(await git(lease.path, ['branch', '--show-current']), '');
      assert.deepEqual(await lease.workspace.listChangedFiles(), []);
    } finally {
      await lease.cleanup();
    }
    await assert.rejects(() => source.ensureCandidate({
      ...frozen, candidateBranch: 'atlas/candidate/OTHER/OTHER',
    }), /candidate_source_frozen_ref_invalid/);
    await assert.rejects(() => source.ensureCandidate({
      ...frozen, headSha: productionHead,
    }), /candidate_source_frozen_ref_invalid/);
    await assert.rejects(() => source.ensureCandidate({
      ...frozen, headSha: 'f'.repeat(40),
    }), /candidate_source_frozen_head_mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifier rejects exact remote HEAD unrelated to frozen base', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-verifier-orphan-'));
  try {
    const { author, remote, productionHead } = await fixture(root);
    const taskId = 'ATLAS-140-UNRELATED';
    const implementationId = 'ATLAS-EXEC-140-UNRELATED';
    const candidateBranch = 'atlas/candidate/' + taskId + '/' + implementationId;
    await git(author, ['checkout', '--orphan', 'unrelated-candidate']);
    await git(author, ['rm', '-rf', '.']);
    await writeFile(path.join(author, 'app.txt'), 'unrelated\n');
    await git(author, ['add', '--', 'app.txt']);
    await git(author, ['commit', '-qm', 'unrelated']);
    const headSha = await git(author, ['rev-parse', 'HEAD']);
    await git(author, [
      'push', remote, 'HEAD:refs/heads/' + candidateBranch,
    ]);
    const source = new CandidateSourceRepository({
      repositoryRoot: path.join(root, 'cache.git'), remote,
    });
    await assert.rejects(() => source.ensureCandidate({
      taskId, implementationId, candidateBranch,
      baseSha: productionHead, headSha,
    }), /candidate_source_not_based_on_frozen_base/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('actual runner boot verifier executes on fetched exact HEAD, then cleans isolated worktree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-runner-frozen-head-'));
  try {
    const { author, remote, productionHead } = await fixture(root);
    const taskId = 'ATLAS-140-RUNNER';
    const implId = 'ATLAS-EXEC-140-IMPL';
    const executionId = 'ATLAS-EXEC-140-VERIFIER';
    const candidateBranch = 'atlas/candidate/' + taskId + '/' + implId;
    await git(author, ['checkout', '-qb', 'candidate-branch']);
    await writeFile(path.join(author, 'app.txt'), 'published head\n');
    await git(author, ['add', '--', 'app.txt']);
    await git(author, ['commit', '-qm', 'published candidate']);
    const headSha = await git(author, ['rev-parse', 'HEAD']);
    await git(author, [
      'push', remote, 'HEAD:refs/heads/' + candidateBranch,
    ]);
    const pair = generateKeyPairSync('ed25519');
    const config = {
      supervisorApiUrl: 'https://api.example.invalid',
      bootstrapToken: 'TEST_ONLY_ACTOR_TOKEN',
      command: 'unused', args: [], workspace: '/never-use-this-workspace',
      pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
      signed: {
        kid: 'local-only-verifier',
        purpose: 'INDEPENDENT_VERIFICATION' as const,
        privateKeyPem: pair.privateKey.export({
          type: 'pkcs8', format: 'pem',
        }).toString(),
      },
      verifierSource: {
        repositoryRoot: path.join(root, 'source.git'),
        workspaceRoot: path.join(root, 'verified'),
        remote,
      },
    };
    const options = createEngineeringRunnerOptions(config, {
      PATH: '/usr/bin', HOME: '/deny/ambient',
    });
    let completed = false;
    let actualHead = '';
    const result = { summary: 'verified frozen HEAD', evidence: {
      rootCause: 'test', changedFiles: ['app.txt'],
      tests: ['PASS'], build: 'PASS', regression: [],
      deploymentState: 'NOT_DEPLOYED', gitState: 'TEST_ONLY',
      remainingRisk: [],
    } };
    const runner = new EngineeringRunner({
      ...options,
      client: {
        claimNext: async () => ({
          purpose: 'INDEPENDENT_VERIFICATION' as const,
          assignment: {
            taskId, executionId, workerRole: 'engineering',
            executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
            objective: 'independent verify', allowedPaths: ['app.txt'],
            forbiddenActions: [], dependencies: [],
            acceptance: [], requiredEvidence: [],
            frozenBaseSha: productionHead,
            reviewCandidate: {
              action: 'merge' as const,
              targetBranch: 'production/atlas' as const,
              baseSha: productionHead, headSha,
              changedFiles: ['app.txt'],
            },
            candidateBranch,
          },
          heartbeat: async () => undefined,
          complete: async () => { completed = true; },
          fail: async (reason: string) => {
            throw Error('unexpected_signed_failure:' + reason);
          },
          cancel: async () => undefined,
        }),
      },
      executorFactory: (cwd: string) => ({
        execute: async () => {
          actualHead = await git(cwd, ['rev-parse', 'HEAD']);
          assert.equal(await git(cwd, ['branch', '--show-current']), '');
          assert.equal(actualHead, headSha);
          return result;
        },
      }),
    });
    assert.equal(await runner.runOnce(), 'completed');
    assert.equal(actualHead, headSha);
    assert.equal(completed, true);
    await assert.rejects(
      git(path.join(root, 'verified', taskId + '--' + executionId),
        ['rev-parse', 'HEAD']),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
