import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./runner.ts')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const implementationAssignment = {
  executionId: 'exec-1',
  taskId: 'task-1',
  workerRole: 'engineering',
  executionPurpose: 'IMPLEMENTATION',
  objective: 'Implement runner',
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

function session(assignment = implementationAssignment) {
  return {
    assignment,
    purpose: assignment.executionPurpose,
    heartbeat: async () => undefined,
    complete: async (_result: unknown) => undefined,
    fail: async (_reason: string) => undefined,
  };
}

test('EngineeringRunner returns idle when claim-next has no work', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  let executed = 0;
  const runner = new Runner({
    client: { claimNext: async () => null },
    executor: { execute: async () => { executed += 1; return result; } },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'idle');
  assert.equal(executed, 0);
});

test('EngineeringRunner heartbeats, enforces exact implementation scope, and completes evidence once', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const active = session();
  let heartbeat = 0;
  let complete = 0;
  let fail = 0;
  active.heartbeat = async () => { heartbeat += 1; };
  active.complete = async (value: unknown) => {
    complete += 1;
    assert.deepEqual(value, result);
  };
  active.fail = async () => { fail += 1; };
  const snapshots = [[], ['apps/example.ts']];
  let scopeCheck: { changed: string[]; allowed: string[] } | undefined;

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
    scopeGuard: {
      assertImplementationScope: (changed: string[], allowed: string[]) => {
        scopeCheck = { changed, allowed };
      },
      assertVerificationNoDrift: () => undefined,
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'completed');
  assert.ok(heartbeat >= 1);
  assert.equal(complete, 1);
  assert.equal(fail, 0);
  assert.deepEqual(scopeCheck, {
    changed: ['apps/example.ts'],
    allowed: ['apps/example.ts'],
  });
});

test('EngineeringRunner fails execution on implementation scope drift and never completes', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const active = session();
  let complete = 0;
  let failReason = '';
  active.complete = async () => { complete += 1; };
  active.fail = async (reason: string) => { failReason = reason; };
  const snapshots = [[], ['outside.ts']];

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
    scopeGuard: {
      assertImplementationScope: () => { throw new Error('scope_drift:outside.ts'); },
      assertVerificationNoDrift: () => undefined,
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(complete, 0);
  assert.match(failReason, /scope_drift/);
});

test('EngineeringRunner rejects implementation evidence when reported changed files do not match Git observation', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const active = session();
  let complete = 0;
  let failReason = '';
  active.complete = async () => { complete += 1; };
  active.fail = async (reason: string) => { failReason = reason; };
  const mismatchedResult = {
    ...result,
    evidence: {
      ...result.evidence,
      changedFiles: [],
    },
  };
  const snapshots = [[], ['apps/example.ts']];

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => mismatchedResult },
    workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(complete, 0);
  assert.match(failReason, /implementation_evidence_changed_files_mismatch/);
});

test('EngineeringRunner rejects independent-verification git drift', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const verificationAssignment = {
    ...implementationAssignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION',
  };
  const active = session(verificationAssignment);
  let complete = 0;
  let failReason = '';
  active.complete = async () => { complete += 1; };
  active.fail = async (reason: string) => { failReason = reason; };
  const snapshots = [['apps/existing.ts'], ['apps/existing.ts', 'apps/new.ts']];

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => ({ ...result, evidence: { ...result.evidence, changedFiles: [] } }) },
    workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => { throw new Error('verification_git_drift'); },
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(complete, 0);
  assert.match(failReason, /verification_git_drift/);
});

test('EngineeringRunner stops its polling loop after AbortSignal cancellation', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { run(signal: AbortSignal): Promise<void> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  let claims = 0;
  const controller = new AbortController();
  const runner = new Runner({
    client: {
      claimNext: async () => {
        claims += 1;
        controller.abort();
        return null;
      },
    },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    pollIntervalMs: 1,
    heartbeatIntervalMs: 10_000,
  });

  await runner.run(controller.signal);
  assert.equal(claims, 1);
});
