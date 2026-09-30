import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function loadModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./scope-guard.ts')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

test('ExactScopeGuard accepts only exact allowed paths and rejects prefix expansion', async () => {
  const mod = await loadModule();
  const Guard = mod.ExactScopeGuard as
    | (new () => {
        assertImplementationScope(changed: string[], allowed: string[]): void;
      })
    | undefined;
  assert.ok(Guard, 'ExactScopeGuard must exist');
  const guard = new Guard();

  assert.doesNotThrow(() =>
    guard.assertImplementationScope(
      ['apps/api/src/exact.ts'],
      ['apps/api/src/exact.ts'],
    ),
  );
  assert.throws(
    () =>
      guard.assertImplementationScope(
        ['apps/api/src/exact.ts/child'],
        ['apps/api/src/exact.ts'],
      ),
    /scope_drift/,
  );
});

test('ExactScopeGuard fails closed on absolute and traversal paths', async () => {
  const mod = await loadModule();
  const Guard = mod.ExactScopeGuard as
    | (new () => {
        assertImplementationScope(changed: string[], allowed: string[]): void;
      })
    | undefined;
  assert.ok(Guard, 'ExactScopeGuard must exist');
  const guard = new Guard();

  assert.throws(
    () => guard.assertImplementationScope(['/tmp/secret'], ['/tmp/secret']),
    /invalid_changed_path/,
  );
  assert.throws(
    () => guard.assertImplementationScope(['../secret'], ['../secret']),
    /invalid_changed_path/,
  );
});

test('independent verification rejects any tracked git drift', async () => {
  const mod = await loadModule();
  const Guard = mod.ExactScopeGuard as
    | (new () => {
        assertVerificationNoDrift(before: string[], after: string[]): void;
      })
    | undefined;
  assert.ok(Guard, 'ExactScopeGuard must exist');
  const guard = new Guard();

  assert.doesNotThrow(() =>
    guard.assertVerificationNoDrift(
      ['apps/api/src/existing.ts'],
      ['apps/api/src/existing.ts'],
    ),
  );
  assert.throws(
    () =>
      guard.assertVerificationNoDrift(
        ['apps/api/src/existing.ts'],
        ['apps/api/src/existing.ts', 'apps/api/src/new.ts'],
      ),
    /verification_git_drift/,
  );
});

test('GitWorkspace is exported from scope-guard.ts for scope-owned workspace inspection', async () => {
  const mod = await loadModule();
  const Workspace = mod.GitWorkspace as
    | (new (cwd: string) => { listChangedFiles(): Promise<string[]> })
    | undefined;

  assert.ok(
    Workspace,
    'GitWorkspace must be exported from scope-guard.ts',
  );
  assert.throws(
    () => new Workspace(''),
    /workspace_cwd_required/,
  );
});

test('GitWorkspace suppresses repository fsmonitor commands and strips runner secrets from Git inspection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-scope-workspace-'));
  try {
    const repo = path.join(root, 'repo');
    await mkdir(repo);
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Atlas Test'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'atlas-test@example.invalid'], { cwd: repo });
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    await execFileAsync('git', ['add', '--', 'tracked.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-qm', 'base'], { cwd: repo });

    const sentinel = path.join(root, 'fsmonitor-ran');
    const fsmonitor = path.join(root, 'fsmonitor.sh');
    await writeFile(fsmonitor, `#!/bin/sh\nprintf '%s' "$ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN" > '${sentinel}'\n`);
    await chmod(fsmonitor, 0o755);
    await execFileAsync('git', ['config', 'core.fsmonitor', fsmonitor], { cwd: repo });

    const mod = await loadModule();
    const Workspace = mod.GitWorkspace as any;
    const workspace = new Workspace(repo, {
      PATH: process.env.PATH,
      HOME: '/sensitive/home',
      ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN: 'source-secret',
    });

    await assert.rejects(
      () => workspace.listChangedFiles(),
      /workspace_git_config_unsafe/,
    );
    assert.equal(workspace.environment.HOME, undefined);
    assert.equal(workspace.environment.ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN, undefined);
    await assert.rejects(() => readFile(sentinel, 'utf8'), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GitWorkspace rejects executable clean filters before status inspection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-scope-filter-'));
  try {
    const repo = path.join(root, 'repo');
    await mkdir(repo);
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Atlas Test'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'atlas-test@example.invalid'], { cwd: repo });
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    await execFileAsync('git', ['add', '--', 'tracked.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-qm', 'base'], { cwd: repo });

    const sentinel = path.join(root, 'filter-ran');
    const filter = path.join(root, 'filter.sh');
    await writeFile(filter, `#!/bin/sh\ntouch '${sentinel}'\ncat\n`);
    await chmod(filter, 0o755);
    await execFileAsync('git', ['config', 'filter.atlas.clean', filter], {
      cwd: repo,
    });

    const mod = await loadModule();
    const Workspace = mod.GitWorkspace as any;
    const workspace = new Workspace(repo, { PATH: process.env.PATH });

    await assert.rejects(
      () => workspace.listChangedFiles(),
      /workspace_git_config_unsafe/,
    );
    await assert.rejects(() => readFile(sentinel, 'utf8'), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parseGitStatusPorcelainZ fail-closes rename and copy scope by returning both destination and source in -z order', async () => {
  const mod = await loadModule();
  const parse = mod.parseGitStatusPorcelainZ as
    | ((input: string) => string[])
    | undefined;
  assert.ok(parse, 'parseGitStatusPorcelainZ must exist');

  assert.deepEqual(
    parse(
      ' M apps/a.ts\0?? apps/b.ts\0R  apps/new.ts\0apps/old.ts\0C  apps/copied.ts\0apps/original.ts\0',
    ),
    [
      'apps/a.ts',
      'apps/b.ts',
      'apps/new.ts',
      'apps/old.ts',
      'apps/copied.ts',
      'apps/original.ts',
    ],
  );
});

test('GitWorkspace fingerprint catches HEAD/ref drift even when worktree status is clean', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-fingerprint-'));
  try {
    const repo = path.join(root, 'repo');
    await mkdir(repo);
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Atlas Test'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repo });
    await writeFile(path.join(repo, 'tracked.txt'), 'base\\n');
    await execFileAsync('git', ['add', '--', 'tracked.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-qm', 'base'], { cwd: repo });
    const { GitWorkspace } = await import('./scope-guard.ts');
    const workspace = new GitWorkspace(repo);
    const before = await workspace.fingerprint();
    assert.equal(before, await workspace.fingerprint());
    await execFileAsync('git', ['commit', '--allow-empty', '-qm', 'change-head'], { cwd: repo });
    assert.deepEqual(await workspace.listChangedFiles(), []);
    assert.notEqual(await workspace.fingerprint(), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
