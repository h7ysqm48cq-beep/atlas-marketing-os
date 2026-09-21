import { PrismaSupervisorLifecycleStore } from './prisma-supervisor-lifecycle.store';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { testOnlySeparatedExecutions } from '../testing/independent-verifier.test-fixture';

const id = 'ISSUE140-TASK';
const path = 'apps/api/src/a.ts';
const taskTime = new Date('2026-09-21T09:01:00.000Z');
const evidence = {
  rootCause: 'isolated verifier check',
  changedFiles: [path],
  tests: ['PASS'],
  build: 'PASS',
  regression: [],
  deploymentState: 'NOT_DEPLOYED',
  gitState: 'ISOLATED',
  remainingRisk: [],
};
function task(status: SupervisorTask['status']): SupervisorTask {
  return {
    id,
    objective: 'atomic verified review',
    owner: 'engineering',
    status,
    allowedPaths: [path],
    forbiddenActions: ['merge'],
    dependsOn: [],
    acceptance: [],
    evidence,
    blockingReason: null,
    failureReason: null,
    createdAt: new Date(taskTime.getTime() - 1000),
    updatedAt: new Date(taskTime.getTime() + (status === 'READY_FOR_REVIEW' ? 1 : 0)),
  };
}
function verifier(overrides: Partial<SupervisorExecution> = {}): SupervisorExecution {
  const completedAt = new Date(taskTime.getTime() + 3000);
  const startedAt = new Date(taskTime.getTime() + 1000);
  return {
    id: 'ISSUE140-VERIFIER',
    taskId: id,
    workerRole: 'engineering',
    status: 'COMPLETED',
    assignment: {
      executionId: 'ISSUE140-VERIFIER',
      taskId: id,
      workerRole: 'engineering',
      executionPurpose: 'INDEPENDENT_VERIFICATION',
      objective: 'test only',
      allowedPaths: [path],
      forbiddenActions: [],
      dependencies: [],
      acceptance: [],
      requiredEvidence: [],
      manifestHash: 'a'.repeat(64),
      claimEpoch: 1,
      leaseId: 'TEST-ONLY',
      runnerId: 'TEST-ONLY',
      bootstrapActor: testOnlySeparatedExecutions(task('VERIFYING'), startedAt)[1]
        .assignment.bootstrapActor,
    },
    result: { summary: 'test-only PASS', evidence },
    error: null,
    createdAt: startedAt,
    startedAt,
    completedAt,
    runnerId: 'TEST-ONLY',
    claimEpoch: 1,
    lastHeartbeatAt: startedAt,
    leaseExpiresAt: completedAt,
    ...overrides,
  };
}
function harness(executions: SupervisorExecution[], rawEvidence: unknown = evidence) {
  const before = { ...task('VERIFYING'), evidence: rawEvidence };
  const after = task('READY_FOR_REVIEW');
  // Synthetic implementation identity record is fixture-only, not attestation.
  const implementation = executions.some(execution =>
    execution.assignment.executionPurpose === 'INDEPENDENT_VERIFICATION' &&
    execution.status === 'COMPLETED',
  ) ? testOnlySeparatedExecutions(task('VERIFYING'),
      new Date(taskTime.getTime() + 1000))[0] : null;
  const rows = implementation ? [implementation, ...executions] : executions;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    supervisorTask: {
      findUnique: jest.fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    supervisorExecution: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
    supervisorFileLock: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
  };
  const store = new PrismaSupervisorLifecycleStore(prisma as never);
  return { tx, prisma, store, ready: after };
}

describe('Issue #140 transaction-local verified review guard (mock Prisma)', () => {
  it('refuses missing verifier before task write and lock release', async () => {
    const { tx, store, ready } = harness([]);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).rejects.toMatchObject({
      response: { code: 'independent_verification_required' },
    });
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it('cannot bypass verifier gate by omitting requireVerifiedReview option', async () => {
    const { tx, store, ready } = harness([]);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime,
    )).rejects.toMatchObject({
      response: { code: 'independent_verification_required' },
    });
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it('implicitly enforces verifier gate on direct valid READY_FOR_REVIEW release', async () => {
    const { tx, store, ready } = harness([verifier()]);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime,
    )).resolves.toMatchObject({ status: 'READY_FOR_REVIEW' });
    expect(tx.supervisorExecution.findMany).toHaveBeenCalledTimes(1);
    expect(tx.supervisorFileLock.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('refuses original persisted evidence mismatched by old mapper before any write', async () => {
    const original = { ...evidence, candidatePublication: { headSha: 'original-only' } };
    const { tx, store, ready } = harness([verifier()], original);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).rejects.toMatchObject({
      response: { code: 'review_evidence_changed_or_unmapped' },
    });
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it('accepts semantically identical persisted evidence with reordered JSON keys', async () => {
    // PostgreSQL JSONB/Prisma may change key order. Fail-closed on changes in
    // value, not on serialization order.
    const rearranged = {
      remainingRisk: [],
      gitState: 'ISOLATED',
      deploymentState: 'NOT_DEPLOYED',
      regression: [],
      build: 'PASS',
      tests: ['PASS'],
      changedFiles: [path],
      rootCause: 'isolated verifier check',
    };
    const { tx, store, ready } = harness([verifier()], rearranged);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).resolves.toMatchObject({ status: 'READY_FOR_REVIEW' });
    expect(tx.supervisorTask.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.supervisorFileLock.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('rejects true nested JSON evidence changes even with reordered keys', async () => {
    const changed = {
      ...evidence,
      remainingRisk: ['original nested content differs'],
    };
    const { tx, store, ready } = harness([verifier()], changed);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).rejects.toMatchObject({
      response: { code: 'review_evidence_changed_or_unmapped' },
    });
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects active verifier without unlocking', async () => {
    const { tx, store, ready } = harness([verifier(), verifier({
      id: 'SECOND-VERIFIER',
      assignment: { ...verifier().assignment, executionId: 'SECOND-VERIFIER' },
      status: 'RUNNING',
      result: null,
      completedAt: null,
    })]);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).rejects.toMatchObject({
      response: { code: 'independent_verification_required' },
    });
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it('stale task version returns null without consulting verifier or releasing locks', async () => {
    const { tx, store, ready } = harness([verifier()]);
    tx.supervisorTask.findUnique.mockReset().mockResolvedValue({
      ...task('VERIFYING'),
      updatedAt: new Date(taskTime.getTime() + 50),
    });
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).resolves.toBeNull();
    expect(tx.supervisorExecution.findMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
  });

  it('checks verifier under transaction locks BEFORE CAS and lock release', async () => {
    const { tx, prisma, store, ready } = harness([verifier()]);
    await expect(store.saveWithLocksIfUnchanged(
      ready, 'release', taskTime, true,
    )).resolves.toMatchObject({
      status: 'READY_FOR_REVIEW',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.supervisorExecution.findMany).toHaveBeenCalledWith({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    });
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(tx.$queryRaw)).toBeLessThan(order(tx.supervisorExecution.findMany));
    expect(order(tx.supervisorExecution.findMany)).toBeLessThan(order(tx.supervisorTask.updateMany));
    expect(order(tx.supervisorTask.updateMany)).toBeLessThan(order(tx.supervisorFileLock.deleteMany));
    expect(tx.supervisorTask.updateMany).toHaveBeenCalledWith({
      where: { id, updatedAt: taskTime },
      data: expect.objectContaining({
        status: 'READY_FOR_REVIEW',
        evidence,
      }),
    });
  });
});
