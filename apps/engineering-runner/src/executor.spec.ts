import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./executor.ts')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const assignment = {
  executionId: 'exec-1',
  taskId: 'task-1',
  workerRole: 'engineering',
  executionPurpose: 'IMPLEMENTATION',
  objective: 'Implement exact scoped change',
  allowedPaths: ['apps/example.ts'],
  forbiddenActions: ['merge', 'deploy_production'],
  dependencies: [],
  acceptance: ['tests pass'],
  requiredEvidence: [],
};

const result = {
  summary: 'done',
  evidence: {
    rootCause: 'implemented',
    changedFiles: ['apps/example.ts'],
    tests: ['PASS'],
    build: 'PASS',
    regression: [],
    deploymentState: 'NOT_DEPLOYED',
    gitState: 'BRANCH_ONLY',
    remainingRisk: [],
  },
};

test('CommandExecutor passes assignment only and strips Supervisor, Owner, and Runner authority from child env', async () => {
  const mod = await loadModule();
  const Executor = mod.CommandExecutor as
    | (new (options: Record<string, unknown>) => {
        execute(value: unknown, signal?: AbortSignal): Promise<unknown>;
      })
    | undefined;
  assert.ok(Executor, 'CommandExecutor must exist');

  let captured: Record<string, unknown> | undefined;
  const executor = new Executor({
    command: 'agent',
    args: ['run'],
    cwd: '/workspace',
    environment: {
      PATH: '/usr/bin',
      HOME: '/home/runner',
      ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN: 'bootstrap-secret',
      ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret',
      ATLAS_EXECUTION_CAPABILITY: 'capability-secret',
      ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN: 'source-secret',
      ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN: 'publisher-secret',
      ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE: 'https://example.invalid/repo.git',
    },
    runProcess: async (input: Record<string, unknown>) => {
      captured = input;
      return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
    },
  });

  await executor.execute(assignment);

  assert.ok(captured);
  assert.equal(captured.command, 'agent');
  assert.deepEqual(captured.args, ['run']);
  assert.equal(captured.stdin, JSON.stringify(assignment));
  const env = captured.env as Record<string, string>;
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/runner');
  assert.equal(env.ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN, undefined);
  assert.equal(env.ATLAS_SUPERVISOR_OWNER_TOKEN, undefined);
  assert.equal(env.ATLAS_EXECUTION_CAPABILITY, undefined);
  assert.equal(env.ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN, undefined);
  assert.equal(env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN, undefined);
  assert.equal(env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE, undefined);
});

test('CommandExecutor returns a validated WorkerExecutionResult', async () => {
  const mod = await loadModule();
  const Executor = mod.CommandExecutor as
    | (new (options: Record<string, unknown>) => {
        execute(value: unknown): Promise<unknown>;
      })
    | undefined;
  assert.ok(Executor, 'CommandExecutor must exist');

  const executor = new Executor({
    command: 'agent',
    args: [],
    cwd: '/workspace',
    environment: {},
    runProcess: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(result),
      stderr: '',
    }),
  });

  assert.deepEqual(await executor.execute(assignment), result);
});

test('CommandExecutor fails closed on process failure or malformed evidence', async () => {
  const mod = await loadModule();
  const Executor = mod.CommandExecutor as
    | (new (options: Record<string, unknown>) => {
        execute(value: unknown): Promise<unknown>;
      })
    | undefined;
  assert.ok(Executor, 'CommandExecutor must exist');

  const failed = new Executor({
    command: 'agent',
    args: [],
    cwd: '/workspace',
    environment: {},
    runProcess: async () => ({ exitCode: 2, stdout: '', stderr: 'boom' }),
  });
  await assert.rejects(() => failed.execute(assignment), /executor_failed/);

  const malformed = new Executor({
    command: 'agent',
    args: [],
    cwd: '/workspace',
    environment: {},
    runProcess: async () => ({ exitCode: 0, stdout: '{}', stderr: '' }),
  });
  await assert.rejects(
    () => malformed.execute(assignment),
    /executor_result_invalid/,
  );
});

import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CommandExecutor } from './executor.ts';

const migrationPath = 'apps/api/prisma/migrations/20260810220000_add_msports_settings_v2/migration.sql';
const appliedSql = 'ALTER TABLE "SportsNewsSetting" ADD COLUMN "newsAiModel" TEXT DEFAULT \'gpt-5.5\';\n';
const editedSql = appliedSql.replace('gpt-5.5', 'gpt-5.6-luna');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function migrationFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-history-'));
  const git = (...args: string[]) => execFileSync('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Atlas Test',
    '-c', 'user.email=atlas-test@example.invalid', ...args,
  ], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  await mkdir(path.dirname(path.join(root, migrationPath)), { recursive: true });
  await writeFile(path.join(root, migrationPath), appliedSql);
  git('add', '--', migrationPath);
  git('commit', '--quiet', '-m', 'applied history');
  const sourceSha = git('rev-parse', 'HEAD');
  await writeFile(path.join(root, migrationPath), editedSql);
  git('add', '--', migrationPath);
  git('commit', '--quiet', '-m', 'historical drift');
  const frozenBaseSha = git('rev-parse', 'HEAD');
  const payload = {
    version: 1, filePath: migrationPath, sourceSha,
    beforeSha256: digest(editedSql), afterSha256: digest(appliedSql),
  };
  const input = {
    ...assignment, allowedPaths: [migrationPath], frozenBaseSha,
    forbiddenActions: ['edit_other_files', 'run_migration', 'change_database_schema', 'merge', 'deploy_production'],
    objective: 'RESTORE_MIGRATION_HISTORY ' + JSON.stringify(payload),
  };
  // The previous executor returns valid evidence but leaves SQL untouched.
  const executor = new CommandExecutor({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(' + JSON.stringify(JSON.stringify(result)) + ')'],
    cwd: root, environment: { PATH: process.env.PATH },
  });
  return { root, git, payload, input, executor };
}

test('history restoration recovers immutable bytes without SQL execution or Git integration', async () => {
  const f = await migrationFixture();
  try {
    const beforeRefs = f.git('show-ref', '--head');
    const beforeIndex = f.git('ls-files', '--stage');
    const restored = await f.executor.execute(f.input);
    assert.equal(await readFile(path.join(f.root, migrationPath), 'utf8'), appliedSql);
    assert.deepEqual(restored.evidence.changedFiles, [migrationPath]);
    assert.equal(restored.evidence.deploymentState, 'NOT_DEPLOYED');
    assert.equal(f.git('rev-parse', 'HEAD'), f.input.frozenBaseSha);
    assert.equal(f.git('show-ref', '--head'), beforeRefs);
    assert.equal(f.git('ls-files', '--stage'), beforeIndex);
    assert.equal(f.git('diff', '--name-only'), migrationPath);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('history restoration rejects invalid scope, hashes, authority and base without changing bytes', async () => {
  const f = await migrationFixture();
  try {
    const cases = [
      { payload: { ...f.payload, filePath: '../escape.sql' } },
      { payload: { ...f.payload, filePath: 'apps/api/prisma/schema.prisma' } },
      { input: { allowedPaths: [migrationPath, 'apps/other.ts'] } },
      { payload: { ...f.payload, beforeSha256: '0'.repeat(64) } },
      { payload: { ...f.payload, afterSha256: '0'.repeat(64) } },
      { payload: { ...f.payload, sourceSha: 'not-a-sha' } },
      { payload: { ...f.payload, sourceSha: '0'.repeat(40) } },
      { payload: { ...f.payload, version: 2 } },
      { payload: { ...f.payload, extra: 'not-admitted' } },
      { input: { frozenBaseSha: f.payload.sourceSha } },
      { input: { executionPurpose: 'INDEPENDENT_VERIFICATION' } },
      { input: { workerRole: 'backend' } },
      { input: { forbiddenActions: [...f.input.forbiddenActions, 'edit_assigned_files'] } },
      { input: { forbiddenActions: [...f.input.forbiddenActions, 'restore_migration_history'] } },
    ];
    for (const c of cases) {
      const input = {
        ...f.input, ...c.input,
        objective: 'RESTORE_MIGRATION_HISTORY ' + JSON.stringify(c.payload ?? f.payload),
      };
      await assert.rejects(() => f.executor.execute(input), /migration_history_restore/);
      assert.equal(await readFile(path.join(f.root, migrationPath), 'utf8'), editedSql);
      assert.equal(f.git('status', '--porcelain'), '');
    }
    await assert.rejects(() => f.executor.execute({
      ...f.input, objective: 'RESTORE_MIGRATION_HISTORY {broken',
    }), /migration_history_restore/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('history restoration rejects both file and parent symlinks before writing', async () => {
  for (const parent of [false, true]) {
    const f = await migrationFixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'atlas-history-outside-'));
    try {
      await writeFile(path.join(outside, 'migration.sql'), editedSql);
      const target = path.join(f.root, migrationPath);
      if (parent) {
        await rm(path.dirname(target), { recursive: true });
        await symlink(outside, path.dirname(target));
      } else {
        await rm(target);
        await symlink(path.join(outside, 'migration.sql'), target);
      }
      await assert.rejects(() => f.executor.execute(f.input), /migration_history_restore/);
      assert.equal(await readFile(path.join(outside, 'migration.sql'), 'utf8'), editedSql);
      assert.equal(await readFile(target, 'utf8'), editedSql);
    } finally {
      await rm(f.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }
});
