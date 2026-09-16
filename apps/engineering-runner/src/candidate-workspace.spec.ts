import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return stdout.trim();
}

async function sourceRepository(root: string): Promise<{ repo: string; head: string }> {
  const repo = path.join(root, 'source');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.name', 'Atlas Test']);
  await git(repo, ['config', 'user.email', 'atlas-test@example.invalid']);
  await writeFile(path.join(repo, 'allowed.txt'), 'base\n');
  await git(repo, ['add', '--', 'allowed.txt']);
  await git(repo, ['commit', '-qm', 'base']);
  return { repo, head: await git(repo, ['rev-parse', 'HEAD']) };
}

test('CandidateWorkspaceManager prepares a clean detached worktree at the frozen base', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-workspace-'));
  try {
    const { repo, head } = await sourceRepository(root);
    const module = await import('./candidate-workspace.ts').catch(() => ({}));
    const Manager = (module as Record<string, unknown>).CandidateWorkspaceManager as
      | (new (options: { repositoryRoot: string; workspaceRoot: string }) => {
          prepare(input: Record<string, unknown>): Promise<any>;
        })
      | undefined;
    assert.ok(Manager, 'CandidateWorkspaceManager must exist');

    const manager = new Manager({
      repositoryRoot: repo,
      workspaceRoot: path.join(root, 'workspaces'),
    });
    const lease = await manager.prepare({
      taskId: 'ATLAS-20260916-task-1',
      executionId: 'ATLAS-EXEC-20260916-exec-1',
      frozenBaseSha: head,
      allowedPaths: ['allowed.txt'],
    });

    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    assert.equal(await git(lease.path, ['branch', '--show-current']), '');
    assert.deepEqual(await lease.workspace.listChangedFiles(), []);
    assert.equal(lease.baseSha, head);
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidateWorkspaceManager rejects unsafe task or execution ids before path creation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-workspace-'));
  try {
    const { repo, head } = await sourceRepository(root);
    const { CandidateWorkspaceManager } = await import('./candidate-workspace.ts');
    const workspaceRoot = path.join(root, 'workspaces');
    const manager = new CandidateWorkspaceManager({ repositoryRoot: repo, workspaceRoot });

    await assert.rejects(
      () => manager.prepare({
        taskId: '../escape',
        executionId: 'ATLAS-EXEC-safe',
        frozenBaseSha: head,
        allowedPaths: ['allowed.txt'],
      }),
      /candidate_workspace_identity_invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidateWorkspaceManager rejects an unknown frozen base as a repository commit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-workspace-'));
  try {
    const { repo } = await sourceRepository(root);
    const { CandidateWorkspaceManager } = await import('./candidate-workspace.ts');
    const manager = new CandidateWorkspaceManager({
      repositoryRoot: repo,
      workspaceRoot: path.join(root, 'workspaces'),
    });

    await assert.rejects(
      () => manager.prepare({
        taskId: 'ATLAS-task-2',
        executionId: 'ATLAS-EXEC-exec-2',
        frozenBaseSha: '0'.repeat(40),
        allowedPaths: ['allowed.txt'],
      }),
      /candidate_workspace_base_invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidateWorkspaceManager rejects traversal in allowed paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-workspace-'));
  try {
    const { repo, head } = await sourceRepository(root);
    const { CandidateWorkspaceManager } = await import('./candidate-workspace.ts');
    const manager = new CandidateWorkspaceManager({
      repositoryRoot: repo,
      workspaceRoot: path.join(root, 'workspaces'),
    });

    await assert.rejects(
      () => manager.prepare({
        taskId: 'ATLAS-task-3',
        executionId: 'ATLAS-EXEC-exec-3',
        frozenBaseSha: head,
        allowedPaths: ['../outside.txt'],
      }),
      /candidate_workspace_allowed_path_invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidateWorkspaceManager rejects allowed paths that escape through symlinks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-workspace-'));
  try {
    const { repo } = await sourceRepository(root);
    const external = path.join(root, 'external');
    await mkdir(external);
    await symlink(external, path.join(repo, 'escape'));
    await git(repo, ['add', '--', 'escape']);
    await git(repo, ['commit', '-qm', 'add escaping symlink']);
    const head = await git(repo, ['rev-parse', 'HEAD']);
    const { CandidateWorkspaceManager } = await import('./candidate-workspace.ts');
    const manager = new CandidateWorkspaceManager({
      repositoryRoot: repo,
      workspaceRoot: path.join(root, 'workspaces'),
    });

    await assert.rejects(
      () => manager.prepare({
        taskId: 'ATLAS-task-4',
        executionId: 'ATLAS-EXEC-exec-4',
        frozenBaseSha: head,
        allowedPaths: ['escape/new.txt'],
      }),
      /candidate_workspace_allowed_path_escape/,
    );
    const worktrees = await git(repo, ['worktree', 'list', '--porcelain']);
    assert.doesNotMatch(worktrees, /ATLAS-task-4--ATLAS-EXEC-exec-4/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidateWorkspaceManager rejects a pre-existing execution workspace path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-workspace-'));
  try {
    const { repo, head } = await sourceRepository(root);
    const workspaceRoot = path.join(root, 'workspaces');
    const executionPath = path.join(
      workspaceRoot,
      'ATLAS-task-5--ATLAS-EXEC-exec-5',
    );
    await mkdir(executionPath, { recursive: true });
    const { CandidateWorkspaceManager } = await import('./candidate-workspace.ts');
    const manager = new CandidateWorkspaceManager({ repositoryRoot: repo, workspaceRoot });

    await assert.rejects(
      () => manager.prepare({
        taskId: 'ATLAS-task-5',
        executionId: 'ATLAS-EXEC-exec-5',
        frozenBaseSha: head,
        allowedPaths: ['allowed.txt'],
      }),
      /candidate_workspace_path_exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
