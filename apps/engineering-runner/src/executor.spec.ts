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

test('CommandExecutor passes assignment only and strips Supervisor/Owner secrets from child env', async () => {
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
