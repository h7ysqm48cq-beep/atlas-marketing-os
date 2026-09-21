import { PrismaSupervisorExecutionStore } from './prisma-supervisor-execution.store';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';

const taskId = 'ISSUE140-TASK';
const id = 'ISSUE140-QUEUED-VERIFIER';
function queuedVerifier(): SupervisorExecution {
  return {
    id,
    taskId,
    workerRole: 'engineering',
    status: 'QUEUED',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'engineering',
      executionPurpose: 'INDEPENDENT_VERIFICATION',
      objective: 'test-only verifier dispatch',
      allowedPaths: ['apps/api/src/a.ts'],
      forbiddenActions: ['merge'],
      dependencies: [],
      acceptance: [],
      requiredEvidence: [],
      manifestHash: 'a'.repeat(64),
    },
    result: null,
    error: null,
    createdAt: new Date('2026-09-21T09:02:00.000Z'),
    startedAt: null,
    completedAt: null,
    runnerId: null,
    claimEpoch: 0,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
  };
}
function harness(status: string | null) {
  const delegate = {
    create: jest.fn().mockResolvedValue(queuedVerifier()),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(status ? [{ status }] : []),
    supervisorExecution: {
      create: jest.fn().mockResolvedValue(queuedVerifier()),
    },
  };
  const prisma = {
    supervisorExecution: delegate,
    $transaction: jest.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
  };
  return { store: new PrismaSupervisorExecutionStore(prisma as never), tx, prisma, delegate };
}

describe('Issue140 verifier dispatch admission transaction (mock Prisma)', () => {
  it('creates queued verifier only after locked task confirms VERIFYING', async () => {
    const { store, tx, prisma, delegate } = harness('VERIFYING');
    await expect(store.create(queuedVerifier())).resolves.toMatchObject({
      status: 'QUEUED',
      assignment: { executionPurpose: 'INDEPENDENT_VERIFICATION' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const sql = tx.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toMatch(/SupervisorTask/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(tx.supervisorExecution.create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.supervisorExecution.create.mock.invocationCallOrder[0],
    );
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('refuses previously-VERIFYING dispatch that reaches create after READY_FOR_REVIEW', async () => {
    const { store, tx, delegate } = harness('READY_FOR_REVIEW');
    await expect(store.create(queuedVerifier())).rejects.toMatchObject({
      response: {
        code: 'task_not_dispatchable',
        current: 'READY_FOR_REVIEW',
        required: 'VERIFYING',
      },
    });
    expect(tx.supervisorExecution.create).not.toHaveBeenCalled();
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('refuses orphaned task and non-QUEUED verifier without insert', async () => {
    const missing = harness(null);
    await expect(missing.store.create(queuedVerifier())).rejects.toMatchObject({
      response: { code: 'task_not_dispatchable', current: null },
    });
    expect(missing.tx.supervisorExecution.create).not.toHaveBeenCalled();
    const invalid = harness('VERIFYING');
    await expect(invalid.store.create({
      ...queuedVerifier(), status: 'COMPLETED',
    })).rejects.toMatchObject({
      response: { code: 'verifier_execution_queue_required' },
    });
    expect(invalid.prisma.$transaction).not.toHaveBeenCalled();
  });
});
