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

test('EngineeringRunner fails a claimed execution when initial workspace snapshot throws', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const active = session();
  let complete = 0;
  let fail = 0;
  let failReason = '';
  active.complete = async () => { complete += 1; };
  active.fail = async (reason: string) => { fail += 1; failReason = reason; };

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: {
      listChangedFiles: async () => {
        throw new Error('spawn git ENOENT');
      },
    },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(fail, 1);
  assert.equal(complete, 0);
  assert.match(failReason, /spawn git ENOENT/);
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

test('EngineeringRunner runs persistent-source preflight exactly once before polling', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { run(signal: AbortSignal): Promise<void> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  let preflight = 0;
  let claims = 0;
  const order: string[] = [];
  const controller = new AbortController();
  const runner = new Runner({
    client: {
      claimNext: async () => {
        claims += 1;
        order.push('claim');
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
    preflight: async () => {
      preflight += 1;
      order.push('preflight');
    },
    pollIntervalMs: 1,
    heartbeatIntervalMs: 10_000,
  });

  await runner.run(controller.signal);
  assert.equal(preflight, 1);
  assert.equal(claims, 1);
  assert.deepEqual(order, ['preflight', 'claim']);
});

test('EngineeringRunner fails startup preflight before claiming any execution', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { run(signal: AbortSignal): Promise<void> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  let claims = 0;
  const controller = new AbortController();
  const runner = new Runner({
    client: { claimNext: async () => { claims += 1; return null; } },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    preflight: async () => {
      throw new Error('candidate_source_preflight_failed');
    },
    pollIntervalMs: 1,
    heartbeatIntervalMs: 10_000,
  });

  await assert.rejects(
    () => runner.run(controller.signal),
    /candidate_source_preflight_failed/,
  );
  assert.equal(claims, 0);
});

test('EngineeringRunner derives the implementation review candidate only from a published receipt', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const frozenBaseSha = 'a'.repeat(40);
  const assignment = { ...implementationAssignment, frozenBaseSha };
  const active = session(assignment);
  let completed: any;
  let failed = 0;
  active.complete = async (value: unknown) => { completed = value; };
  active.fail = async () => { failed += 1; };

  const receipt = {
    taskId: assignment.taskId,
    executionId: assignment.executionId,
    candidateBranch: `atlas/candidate/${assignment.taskId}/${assignment.executionId}`,
    baseSha: frozenBaseSha,
    headSha: 'b'.repeat(40),
    changedFiles: ['apps/example.ts'],
    targetBranch: 'production/atlas',
    remoteHeadSha: 'b'.repeat(40),
    remoteVerified: true,
  };
  let prepared = 0;
  let published: any;
  let cleaned = 0;
  const snapshots = [[], ['apps/example.ts']];
  const fakeExecutorResult: any = {
    ...result,
    evidence: {
      ...result.evidence,
      reviewCandidate: {
        action: 'merge', targetBranch: 'production/atlas',
        baseSha: 'c'.repeat(40), headSha: 'd'.repeat(40),
        changedFiles: ['fake.ts'],
      },
    },
  };

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => { throw new Error('legacy_executor_used'); } },
    workspace: { listChangedFiles: async () => { throw new Error('legacy_workspace_used'); } },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => {
        prepared += 1;
        return {
          path: '/isolated/candidate',
          baseSha: frozenBaseSha,
          workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
          cleanup: async () => { cleaned += 1; },
        };
      },
    },
    executorFactory: (cwd: string) => {
      assert.equal(cwd, '/isolated/candidate');
      return { execute: async () => fakeExecutorResult };
    },
    candidatePublisher: {
      publish: async (input: unknown) => {
        published = input;
        return receipt;
      },
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'completed');
  assert.equal(prepared, 1);
  assert.equal(failed, 0);
  assert.equal(cleaned, 1);
  assert.equal(published.workspace, '/isolated/candidate');
  assert.deepEqual(completed.evidence.candidatePublication, receipt);
  assert.deepEqual(completed.evidence.reviewCandidate, {
    action: 'merge',
    targetBranch: 'production/atlas',
    baseSha: receipt.baseSha,
    headSha: receipt.headSha,
    changedFiles: receipt.changedFiles,
  });
});

test('EngineeringRunner completes a frozen zero-diff implementation without publishing an empty candidate', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as new (options: Record<string, unknown>) => {
    runOnce(): Promise<unknown>;
  };
  const frozenBaseSha = 'a'.repeat(40);
  const assignment = { ...implementationAssignment, frozenBaseSha };
  const active = session(assignment);
  let completed: any;
  let published = 0;
  let cleaned = 0;
  active.complete = async (value: unknown) => { completed = value; };
  const zeroDiffResult: any = {
    ...result,
    evidence: {
      ...result.evidence,
      changedFiles: [],
      candidatePublication: { forged: true },
      existingCandidateVerification: { forged: true },
      reviewCandidate: {
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: 'c'.repeat(40),
        headSha: 'd'.repeat(40),
        changedFiles: ['fake.ts'],
      },
    },
  };
  const snapshots: string[][] = [[], []];

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => { throw new Error('legacy_executor_used'); } },
    workspace: { listChangedFiles: async () => { throw new Error('legacy_workspace_used'); } },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => ({
        path: '/isolated/zero-diff',
        baseSha: frozenBaseSha,
        workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
        cleanup: async () => { cleaned += 1; },
      }),
    },
    executorFactory: () => ({ execute: async () => zeroDiffResult }),
    candidatePublisher: {
      publish: async () => {
        published += 1;
        throw new Error('zero_diff_publication_forbidden');
      },
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'completed');
  assert.equal(published, 0);
  assert.equal(cleaned, 1);
  assert.deepEqual(completed.evidence.changedFiles, []);
  assert.equal(completed.evidence.candidatePublication, undefined);
  assert.equal(completed.evidence.existingCandidateVerification, undefined);
  assert.equal(completed.evidence.reviewCandidate, undefined);
});

test('EngineeringRunner independently verifies a clean same-SHA runtime refresh without publication', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as new (options: Record<string, unknown>) => {
    runOnce(): Promise<unknown>;
  };
  const sha = 'a'.repeat(40);
  const assignment = {
    ...implementationAssignment, executionPurpose: 'INDEPENDENT_VERIFICATION',
    verificationMode: 'EXISTING_CANDIDATE', candidateBaseSha: sha,
    candidateHeadSha: sha, productionBaselineSha: sha,
  };
  const active = session(assignment);
  let completed: any;
  let published = 0;
  let verified = 0;
  active.complete = async (value: unknown) => { completed = value; };
  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => { throw new Error('wrong_workspace'); } },
    workspace: { listChangedFiles: async () => { throw new Error('wrong_workspace'); } },
    scopeGuard: {
      assertImplementationScope: () => { throw new Error('implementation_scope_used'); },
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: { prepare: async (input: any) => {
      assert.equal(input.frozenBaseSha, sha);
      return { path: '/isolated/runtime', baseSha: sha,
        workspace: { listChangedFiles: async () => [], fingerprint: async () => 'f'.repeat(64) },
        cleanup: async () => undefined };
    } },
    executorFactory: () => ({ execute: async () => ({ ...result,
      evidence: { ...result.evidence, changedFiles: [], candidatePublication: undefined,
        reviewCandidate: undefined } }) }),
    verifyProductionHead: async (value: string) => { assert.equal(value, sha); verified += 1; },
    candidatePublisher: { publish: async () => { published += 1; throw new Error('published'); } },
    heartbeatIntervalMs: 10_000,
  });
  assert.equal(await runner.runOnce(), 'completed');
  assert.equal(verified, 2);
  assert.equal(published, 0);
  assert.deepEqual(completed.evidence.changedFiles, []);
  assert.equal(completed.evidence.candidatePublication, undefined);
  assert.deepEqual(completed.evidence.reviewCandidate, {
    action: 'deploy_production', targetBranch: 'production/atlas',
    baseSha: sha, headSha: sha, changedFiles: [],
  });
  assert.equal(completed.evidence.existingCandidateVerification.sourceVerified, true);
});

test('EngineeringRunner fails once and never completes when candidate publication fails', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const assignment = { ...implementationAssignment, frozenBaseSha: 'a'.repeat(40) };
  const active = session(assignment);
  let complete = 0;
  let fail = 0;
  let failReason = '';
  let cleaned = 0;
  active.complete = async () => { complete += 1; };
  active.fail = async (reason: string) => { fail += 1; failReason = reason; };
  const snapshots = [[], ['apps/example.ts']];

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => ({
        path: '/isolated/failure',
        baseSha: assignment.frozenBaseSha,
        workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
        cleanup: async () => { cleaned += 1; },
      }),
    },
    executorFactory: () => ({ execute: async () => result }),
    candidatePublisher: {
      publish: async () => { throw new Error('candidate_push_failed'); },
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(fail, 1);
  assert.equal(complete, 0);
  assert.match(failReason, /candidate_push_failed/);
  assert.equal(cleaned, 1);
});

test('EngineeringRunner never invokes candidate publication for independent verification', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as
    | (new (options: Record<string, unknown>) => { runOnce(): Promise<unknown> })
    | undefined;
  assert.ok(Runner, 'EngineeringRunner must exist');

  const assignment = {
    ...implementationAssignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION',
    frozenBaseSha: 'a'.repeat(40),
  };
  const active = session(assignment);
  let prepared = 0;
  let published = 0;
  let completed = 0;
  active.complete = async () => { completed += 1; };
  const verificationResult = {
    ...result,
    evidence: { ...result.evidence, changedFiles: [] },
  };
  const snapshots = [[], []];

  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => verificationResult },
    workspace: { listChangedFiles: async () => snapshots.shift() ?? [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => {
        prepared += 1;
        throw new Error('verifier_candidate_workspace_forbidden');
      },
    },
    executorFactory: () => ({ execute: async () => verificationResult }),
    candidatePublisher: {
      publish: async () => {
        published += 1;
        throw new Error('verifier_publication_forbidden');
      },
    },
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'completed');
  assert.equal(prepared, 0);
  assert.equal(published, 0);
  assert.equal(completed, 1);
});

test('EngineeringRunner verifies an existing candidate in its detached workspace without publishing', async () => {
  const mod = await loadModule();
  const Runner = mod.EngineeringRunner as any;
  const assignment = {
    ...implementationAssignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION',
    verificationMode: 'EXISTING_CANDIDATE',
    candidateBaseSha: 'a'.repeat(40),
    candidateHeadSha: 'b'.repeat(40),
    productionBaselineSha: 'c'.repeat(40),
  };
  const active = session(assignment);
  let prepared: any;
  let published = 0;
  active.complete = async () => undefined;
  const runner = new Runner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async (input: any) => {
        prepared = input;
        return {
          path: '/tmp/exact-head', baseSha: input.candidateBaseSha,
          verifiedHeadSha: input.candidateHeadSha,
          verifiedChangedPaths: ['apps/example.ts'],
          verifyProductionBaseline: async () => undefined,
          workspace: {
            listChangedFiles: async () => [],
            fingerprint: async () => 'unchanged-git-state',
          },
          cleanup: async () => undefined,
        };
      },
    },
    executorFactory: () => ({ execute: async () => result }),
    heartbeatIntervalMs: 10_000,
  });

  assert.equal(await runner.runOnce(), 'completed');
  assert.equal(prepared.candidateHeadSha, 'b'.repeat(40));
  assert.equal(published, 0);
});

test('Existing-candidate verifier fails closed when immutable Git fingerprint changes', async () => {
  const { EngineeringRunner } = await import('./runner.ts');
  const assignment = {
    ...implementationAssignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
    verificationMode: 'EXISTING_CANDIDATE' as const,
    candidateBaseSha: 'a'.repeat(40),
    candidateHeadSha: 'b'.repeat(40),
    productionBaselineSha: 'a'.repeat(40),
  };
  const active = session(assignment) as any;
  let completed = 0;
  let failed = '';
  active.complete = async () => { completed++; };
  active.fail = async (reason: string) => { failed = reason; };
  let snapshots = 0;
  const runner = new EngineeringRunner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => ({
        path: '/tmp/head', baseSha: 'a'.repeat(40),
        verifiedHeadSha: 'b'.repeat(40),
        verifiedChangedPaths: ['apps/example.ts'],
        verifyProductionBaseline: async () => undefined,
        workspace: {
          listChangedFiles: async () => [],
          fingerprint: async () => ++snapshots === 1 ? 'before' : 'after',
        },
        cleanup: async () => undefined,
      }),
    },
    executorFactory: () => ({ execute: async () => result }),
  });
  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(completed, 0);
  assert.match(failed, /existing_candidate_git_fingerprint_drift/);
});

test('Exact-target runner executes once and does not enter ordinary polling', async () => {
  const { EngineeringRunner } = await import('./runner.ts');
  let claims = 0;
  let preflights = 0;
  const runner = new EngineeringRunner({
    client: { claimNext: async () => { claims++; return null; } },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    preflight: async () => { preflights++; },
    singleShot: true,
  });
  await runner.run(new AbortController().signal);
  assert.equal(claims, 1);
  assert.equal(preflights, 1);
});

test('Exact existing-candidate verifier refuses completion when production moves during execution', async () => {
  const { EngineeringRunner } = await import('./runner.ts');
  const assignment = {
    ...implementationAssignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
    verificationMode: 'EXISTING_CANDIDATE' as const,
    candidateBaseSha: 'a'.repeat(40),
    candidateHeadSha: 'b'.repeat(40),
    productionBaselineSha: 'c'.repeat(40),
  };
  const active = session(assignment) as any;
  let completed = 0;
  let failed = '';
  active.complete = async () => { completed++; };
  active.fail = async (reason: string) => { failed = reason; };
  const runner = new EngineeringRunner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => ({
        path: '/tmp/head', baseSha: 'a'.repeat(40),
        verifiedHeadSha: 'b'.repeat(40),
        verifiedChangedPaths: ['apps/example.ts'],
        verifyProductionBaseline: async () => {
          throw new Error('existing_candidate_production_baseline_drift');
        },
        workspace: {
          listChangedFiles: async () => [],
          fingerprint: async () => 'unchanged-git-state',
        },
        cleanup: async () => undefined,
      }),
    },
    executorFactory: () => ({ execute: async () => result }),
  });
  assert.equal(await runner.runOnce(), 'failed');
  assert.equal(completed, 0);
  assert.match(failed, /existing_candidate_production_baseline_drift/);
});

test('existing-candidate heartbeat survives slow final canonical production check', async () => {
  const { EngineeringRunner } = await import('./runner.ts');
  const assignment = {
    ...implementationAssignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
    verificationMode: 'EXISTING_CANDIDATE' as const,
    candidateBaseSha: 'a'.repeat(40),
    candidateHeadSha: 'b'.repeat(40),
    productionBaselineSha: 'c'.repeat(40),
  };
  const active = session(assignment) as any;
  let heartbeats = 0;
  let heartbeatsAtCompletion = 0;
  active.heartbeat = async () => { heartbeats++; };
  active.complete = async () => { heartbeatsAtCompletion = heartbeats; };
  const runner = new EngineeringRunner({
    client: { claimNext: async () => active },
    executor: { execute: async () => result },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope: () => undefined,
      assertVerificationNoDrift: () => undefined,
    },
    candidateWorkspaceManager: {
      prepare: async () => ({
        path: '/tmp/head', baseSha: 'a'.repeat(40),
        verifiedHeadSha: 'b'.repeat(40),
        verifiedChangedPaths: ['apps/example.ts'],
        verifyProductionBaseline: async () => {
          await new Promise(resolve => setTimeout(resolve, 65));
        },
        workspace: {
          listChangedFiles: async () => [],
          fingerprint: async () => 'unchanged-git-state',
        },
        cleanup: async () => undefined,
      }),
    },
    executorFactory: () => ({ execute: async () => result }),
    heartbeatIntervalMs: 5,
  });
  assert.equal(await runner.runOnce(), 'completed');
  assert.ok(heartbeatsAtCompletion > 2,
    'heartbeat must continue throughout the final remote source check');
});
