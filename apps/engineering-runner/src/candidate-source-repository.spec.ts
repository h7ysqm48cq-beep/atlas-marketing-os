import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CandidateSourceRepository } from "./candidate-source-repository.ts";
import { CandidateWorkspaceManager } from "./candidate-workspace.ts";

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

test('Existing candidate fetches exact unmerged head from source and binds production base', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-existing-source-'));
  try {
    const { author, remote, productionHead: base } = await fixture(root);
    await git(author, ['checkout', '-qb', 'candidate']);
    await writeFile(path.join(author, 'app.txt'), 'candidate\\n');
    await git(author, ['add', '--', 'app.txt']);
    await git(author, ['commit', '-qm', 'candidate']);
    const head = await git(author, ['rev-parse', 'HEAD']);
    await git(author, ['push', remote, 'HEAD:refs/heads/candidate']);
    const source = new CandidateSourceRepository({
      repositoryRoot: path.join(root, 'mirror.git'), remote,
    });
    await source.ensureExistingCandidate(base, head);
    assert.equal(await git(path.join(root, 'mirror.git'), [
      'rev-parse', '--verify', 'FETCH_HEAD^{commit}',
    ]), head);
    await assert.rejects(source.ensureExistingCandidate(base, 'f'.repeat(40)),
      /existing_candidate_source_identity_unverified/);
    await assert.rejects(source.ensureExistingCandidate(head, base),
      /candidate_source_base_not_production_ancestor/);
    await source.ensureProductionHead(base);
    await git(author, ['push', remote, 'HEAD:refs/heads/production/atlas']);
    await assert.rejects(source.ensureProductionHead(base),
      /existing_candidate_production_baseline_drift/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('advancing production permits only disjoint frozen candidate scope and rejects overlap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-production-advance-'));
  try {
    const { author, remote, productionHead: base } = await fixture(root);
    await git(author, ['checkout', '-qb', 'candidate']);
    await writeFile(path.join(author, 'candidate.txt'), 'candidate\\n');
    await git(author, ['add', '--', 'candidate.txt']);
    await git(author, ['commit', '-qm', 'candidate']);
    const head = await git(author, ['rev-parse', 'HEAD']);
    await git(author, ['push', remote, 'HEAD:refs/heads/candidate']);
    await git(author, ['checkout', 'production/atlas']);
    await writeFile(path.join(author, 'unrelated.txt'), 'production\\n');
    await git(author, ['add', '--', 'unrelated.txt']);
    await git(author, ['commit', '-qm', 'advance production']);
    const production = await git(author, ['rev-parse', 'HEAD']);
    await git(author, ['push', remote, 'HEAD:refs/heads/production/atlas']);
    const source = new CandidateSourceRepository({
      repositoryRoot: path.join(root, 'mirror.git'), remote,
    });
    await source.ensureExistingCandidate(base, head);
    await source.ensureProductionAdvance(base, production, ['candidate.txt']);
    await assert.rejects(
      source.ensureProductionAdvance(base, production, ['unrelated.txt']),
      /existing_candidate_production_scope_overlap/,
    );
    await assert.rejects(
      source.ensureProductionAdvance(base, base, ['candidate.txt']),
      /existing_candidate_production_baseline_drift/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('production rename of an allowed source path is overlapping and must fail closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-production-rename-'));
  try {
    const { author, remote, productionHead: base } = await fixture(root);
    await git(author, ['mv', 'app.txt', 'renamed.txt']);
    await git(author, ['commit', '-qm', 'rename allowed source']);
    const production = await git(author, ['rev-parse', 'HEAD']);
    await git(author, ['push', remote, 'HEAD:refs/heads/production/atlas']);
    const source = new CandidateSourceRepository({
      repositoryRoot: path.join(root, 'mirror.git'), remote,
    });
    await assert.rejects(
      source.ensureProductionAdvance(base, production, ['app.txt']),
      /existing_candidate_production_scope_overlap/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('production moving between source checks fails closed without accepting stale baseline', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-advance-race-'));
  try {
    const { author, remote, productionHead: base } = await fixture(root);
    await writeFile(path.join(author, 'unrelated.txt'), 'advance one\\n');
    await git(author, ['add', '--', 'unrelated.txt']);
    await git(author, ['commit', '-qm', 'first production advance']);
    const production = await git(author, ['rev-parse', 'HEAD']);
    await git(author, ['push', remote, 'HEAD:refs/heads/production/atlas']);
    await writeFile(path.join(author, 'second.txt'), 'advance two\\n');
    await git(author, ['add', '--', 'second.txt']);
    await git(author, ['commit', '-qm', 'second production advance']);
    const source = new CandidateSourceRepository({
      repositoryRoot: path.join(root, 'mirror.git'), remote,
    });
    const originalEnsureBase = source.ensureBase.bind(source);
    (source as any).ensureBase = async (sha: string) => {
      await originalEnsureBase(sha);
      await git(author, ['push', remote, 'HEAD:refs/heads/production/atlas']);
    };
    await assert.rejects(
      source.ensureProductionAdvance(base, production, ['app.txt']),
      /existing_candidate_production_baseline_drift/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
