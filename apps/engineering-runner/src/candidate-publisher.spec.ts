import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { CandidateWorkspaceManager } from './candidate-workspace.ts';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return stdout.trim();
}

async function fixture(root: string) {
  const repo = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.name', 'Atlas Test']);
  await git(repo, ['config', 'user.email', 'atlas-test@example.invalid']);
  await writeFile(path.join(repo, 'allowed.txt'), 'base\n');
  await writeFile(path.join(repo, 'other.txt'), 'other-base\n');
  await git(repo, ['add', '--', 'allowed.txt', 'other.txt']);
  await git(repo, ['commit', '-qm', 'base']);
  const head = await git(repo, ['rev-parse', 'HEAD']);
  await execFileAsync('git', ['init', '--bare', '-q', remote]);
  const manager = new CandidateWorkspaceManager({
    repositoryRoot: repo,
    workspaceRoot: path.join(root, 'workspaces'),
  });
  const lease = await manager.prepare({
    taskId: 'ATLAS-task-1',
    executionId: 'ATLAS-EXEC-exec-1',
    frozenBaseSha: head,
    allowedPaths: ['allowed.txt'],
  });
  return { repo, remote, head, lease };
}

test('CandidatePublisher publishes one exact remote-verified candidate branch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const module = await import('./candidate-publisher.ts').catch(() => ({}));
    const Publisher = (module as Record<string, unknown>).CandidatePublisher as
      | (new (options: { remote: string }) => {
          publish(input: Record<string, unknown>): Promise<any>;
        })
      | undefined;
    assert.ok(Publisher, 'CandidatePublisher must exist');

    const publisher = new Publisher({ remote });
    const receipt = await publisher.publish({
      taskId: 'ATLAS-task-1',
      executionId: 'ATLAS-EXEC-exec-1',
      executionPurpose: 'IMPLEMENTATION',
      workspace: lease.path,
      frozenBaseSha: head,
      targetBranch: 'production/atlas',
      changedFiles: ['allowed.txt'],
    });
    assert.equal(receipt.taskId, 'ATLAS-task-1');
    assert.equal(receipt.executionId, 'ATLAS-EXEC-exec-1');
    assert.equal(
      receipt.candidateBranch,
      'atlas/candidate/ATLAS-task-1/ATLAS-EXEC-exec-1',
    );
    assert.equal(receipt.baseSha, head);
    assert.match(receipt.headSha, /^[0-9a-f]{40}$/);
    assert.notEqual(receipt.headSha, head);
    assert.deepEqual(receipt.changedFiles, ['allowed.txt']);
    assert.equal(receipt.targetBranch, 'production/atlas');
    assert.equal(receipt.remoteHeadSha, receipt.headSha);
    assert.equal(receipt.remoteVerified, true);

    const remoteRef = await git(lease.path, [
      'ls-remote',
      '--heads',
      remote,
      `refs/heads/${receipt.candidateBranch}`,
    ]);
    assert.match(remoteRef, new RegExp(`^${receipt.headSha}\\s`));
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('CandidatePublisher rejects an extra tracked change before commit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\
');
    await writeFile(path.join(lease.path, 'other.txt'), 'other-changed\
');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-2',
        executionId: 'ATLAS-EXEC-exec-2',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_changed_files_mismatch/,
    );

    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote,
      'refs/heads/atlas/candidate/ATLAS-task-2/ATLAS-EXEC-exec-2',
    ]);
    assert.equal(remoteRef, '');
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects an extra untracked change before commit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    await writeFile(path.join(lease.path, 'outside.txt'), 'outside\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-3',
        executionId: 'ATLAS-EXEC-exec-3',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_changed_files_mismatch/,
    );

    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote,
      'refs/heads/atlas/candidate/ATLAS-task-3/ATLAS-EXEC-exec-3',
    ]);
    assert.equal(remoteRef, '');
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects pre-staged content before publication', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    await git(lease.path, ['add', '--', 'allowed.txt']);
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-4',
        executionId: 'ATLAS-EXEC-exec-4',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_index_not_clean/,
    );

    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects publication when workspace HEAD is not the frozen base', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'other.txt'), 'other-second\n');
    await git(lease.path, ['add', '--', 'other.txt']);
    await git(lease.path, ['-c', 'user.name=Atlas Test', '-c', 'user.email=atlas-test@example.invalid', 'commit', '-qm', 'advance']);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-5',
        executionId: 'ATLAS-EXEC-exec-5',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_base_mismatch/,
    );

    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote,
      'refs/heads/atlas/candidate/ATLAS-task-5/ATLAS-EXEC-exec-5',
    ]);
    assert.equal(remoteRef, '');
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects an existing deterministic remote candidate branch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    const branch = 'atlas/candidate/ATLAS-task-6/ATLAS-EXEC-exec-6';
    await git(lease.path, ['push', remote, `${head}:refs/heads/${branch}`]);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-6',
        executionId: 'ATLAS-EXEC-exec-6',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_remote_branch_exists/,
    );

    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote, `refs/heads/${branch}`,
    ]);
    assert.match(remoteRef, new RegExp(`^${head}\\s`));
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects non-implementation publication requests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-7',
        executionId: 'ATLAS-EXEC-exec-7',
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      } as any),
      /candidate_publication_purpose_invalid/,
    );
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects any integration target other than production/atlas', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-8',
        executionId: 'ATLAS-EXEC-exec-8',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'main',
        changedFiles: ['allowed.txt'],
      } as any),
      /candidate_publication_target_invalid/,
    );
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects a changed path replaced by an escaping symlink', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    const outside = path.join(root, 'outside-secret.txt');
    await writeFile(outside, 'secret\n');
    await unlink(path.join(lease.path, 'allowed.txt'));
    await symlink(outside, path.join(lease.path, 'allowed.txt'));
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-9',
        executionId: 'ATLAS-EXEC-exec-9',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_symlink_escape/,
    );

    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    assert.equal(await import('node:fs/promises').then(fs => fs.readFile(outside, 'utf8')), 'secret\n');
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects when the remote ref does not remain at the pushed candidate SHA', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    const hook = path.join(remote, 'hooks', 'post-receive');
    await writeFile(hook, `#!/bin/sh\nwhile read old new ref; do\n  git update-ref "$ref" ${head}\ndone\n`);
    await chmod(hook, 0o755);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-10',
        executionId: 'ATLAS-EXEC-exec-10',
        executionPurpose: 'IMPLEMENTATION',
        workspace: lease.path,
        frozenBaseSha: head,
        targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_remote_sha_mismatch/,
    );

    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote,
      'refs/heads/atlas/candidate/ATLAS-task-10/ATLAS-EXEC-exec-10',
    ]);
    assert.match(remoteRef, new RegExp(`^${head}\\s`));
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects a candidate commit whose parents are not exactly the frozen base', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    const tree = await git(lease.path, ['rev-parse', 'HEAD^{tree}']);
    const secondParent = await git(lease.path, [
      '-c', 'user.name=Atlas Test', '-c', 'user.email=atlas-test@example.invalid',
      'commit-tree', tree, '-p', head, '-m', 'second parent',
    ]);
    const mergeHeadPathRaw = await git(lease.path, ['rev-parse', '--git-path', 'MERGE_HEAD']);
    const mergeHeadPath = path.isAbsolute(mergeHeadPathRaw)
      ? mergeHeadPathRaw
      : path.join(lease.path, mergeHeadPathRaw);
    await writeFile(mergeHeadPath, `${secondParent}\n`);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-11', executionId: 'ATLAS-EXEC-exec-11',
        executionPurpose: 'IMPLEMENTATION', workspace: lease.path,
        frozenBaseSha: head, targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_parent_mismatch/,
    );
    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote,
      'refs/heads/atlas/candidate/ATLAS-task-11/ATLAS-EXEC-exec-11',
    ]);
    assert.equal(remoteRef, '');
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects post-commit diff expansion introduced by a commit hook', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    const hooksDir = path.join(root, 'hooks');
    await mkdir(hooksDir);
    const hook = path.join(hooksDir, 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho hook-change > other.txt\ngit add -- other.txt\n');
    await chmod(hook, 0o755);
    await git(lease.path, ['config', 'core.hooksPath', hooksDir]);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-12', executionId: 'ATLAS-EXEC-exec-12',
        executionPurpose: 'IMPLEMENTATION', workspace: lease.path,
        frozenBaseSha: head, targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_diff_mismatch/,
    );
    const remoteRef = await git(lease.path, [
      'ls-remote', '--heads', remote,
      'refs/heads/atlas/candidate/ATLAS-task-12/ATLAS-EXEC-exec-12',
    ]);
    assert.equal(remoteRef, '');
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects unsafe task or execution ids before committing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: '../production', executionId: 'ATLAS-EXEC-exec-13',
        executionPurpose: 'IMPLEMENTATION', workspace: lease.path,
        frozenBaseSha: head, targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_identity_invalid/,
    );
    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CandidatePublisher rejects a staged-file mismatch immediately after exact git add', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-candidate-publisher-'));
  try {
    const { remote, head, lease } = await fixture(root);
    const hooksDir = path.join(root, 'index-hooks');
    const guard = path.join(root, 'index-hook-done');
    await mkdir(hooksDir);
    const hook = path.join(hooksDir, 'post-index-change');
    await writeFile(
      hook,
      `#!/bin/sh\nif [ ! -f '${guard}' ]; then\n  touch '${guard}'\n  printf 'hook-change\\n' > other.txt\n  git add -- other.txt\nfi\n`,
    );
    await chmod(hook, 0o755);
    await git(lease.path, ['config', 'core.hooksPath', hooksDir]);
    await writeFile(path.join(lease.path, 'allowed.txt'), 'changed\n');
    const { CandidatePublisher } = await import('./candidate-publisher.ts');
    const publisher = new CandidatePublisher({ remote });

    await assert.rejects(
      () => publisher.publish({
        taskId: 'ATLAS-task-14', executionId: 'ATLAS-EXEC-exec-14',
        executionPurpose: 'IMPLEMENTATION', workspace: lease.path,
        frozenBaseSha: head, targetBranch: 'production/atlas',
        changedFiles: ['allowed.txt'],
      }),
      /candidate_publication_staged_files_mismatch/,
    );
    assert.equal(await git(lease.path, ['rev-parse', 'HEAD']), head);
    await lease.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
