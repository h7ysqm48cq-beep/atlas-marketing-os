import { ConflictException } from '@nestjs/common';
import type { SupervisorTask } from '../agent-supervisor.types';
import { PrismaSupervisorLifecycleStore } from './prisma-supervisor-lifecycle.store';

function task(overrides: Partial<SupervisorTask> = {}): SupervisorTask {
  const now = new Date('2026-08-30T00:00:00.000Z');
  return {
    id: 'ATLAS-1',
    objective: 'Atomic lifecycle transition',
    owner: 'backend',
    status: 'WORKING',
    allowedPaths: ['apps/api/src/a.ts', 'apps/api/src/b.ts'],
    forbiddenActions: ['merge'],
    dependsOn: [],
    acceptance: ['atomic state and lock change'],
    evidence: null,
    blockingReason: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function persistedRecord(value: SupervisorTask) {
  return {
    ...value,
    allowedPaths: [...value.allowedPaths],
    forbiddenActions: [...value.forbiddenActions],
    dependsOn: [...value.dependsOn],
    acceptance: [...value.acceptance],
    evidence: value.evidence ? structuredClone(value.evidence) : null,
  };
}

function mockPrisma() {
  const tx = {
    supervisorTask: {
      update: jest.fn(),
    },
    supervisorFileLock: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
}

describe('PrismaSupervisorLifecycleStore', () => {
  it('acquires locks and saves the task in one transaction', async () => {
    const { prisma, tx } = mockPrisma();
    const input = task();
    tx.supervisorFileLock.findMany.mockResolvedValue([]);
    tx.supervisorFileLock.createMany.mockResolvedValue({ count: 2 });
    tx.supervisorTask.update.mockResolvedValue(persistedRecord(input));
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    await expect(store.saveWithLocks(input, 'acquire')).resolves.toMatchObject({
      id: input.id,
      status: 'WORKING',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.supervisorFileLock.createMany).toHaveBeenCalledWith({
      data: [
        { path: 'apps/api/src/a.ts', taskId: 'ATLAS-1' },
        { path: 'apps/api/src/b.ts', taskId: 'ATLAS-1' },
      ],
    });
    expect(tx.supervisorTask.update).toHaveBeenCalledTimes(1);
  });

  it('releases owned locks and saves the task in one transaction', async () => {
    const { prisma, tx } = mockPrisma();
    const input = task({ status: 'READY_FOR_REVIEW' });
    tx.supervisorFileLock.deleteMany.mockResolvedValue({ count: 2 });
    tx.supervisorTask.update.mockResolvedValue(persistedRecord(input));
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    await expect(store.saveWithLocks(input, 'release')).resolves.toMatchObject({
      status: 'READY_FOR_REVIEW',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.supervisorFileLock.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 'ATLAS-1' },
    });
    expect(tx.supervisorTask.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a conflicting lock owner without persisting the task transition', async () => {
    const { prisma, tx } = mockPrisma();
    const input = task();
    tx.supervisorFileLock.findMany.mockResolvedValue([
      { path: 'apps/api/src/a.ts', taskId: 'ATLAS-OTHER' },
    ]);
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    await expect(store.saveWithLocks(input, 'acquire')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.supervisorTask.update).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.createMany).not.toHaveBeenCalled();
  });

  it('translates Prisma 7 driver-adapter path uniqueness into file ownership conflict', async () => {
    const { prisma, tx } = mockPrisma();
    const input = task();
    tx.supervisorFileLock.findMany.mockResolvedValue([]);
    tx.supervisorFileLock.createMany.mockRejectedValue({
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: {
            originalMessage:
              'duplicate key value violates unique constraint "SupervisorFileLock_pkey"',
            constraint: { fields: ['"path"'] },
          },
        },
      },
    });
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    await expect(store.saveWithLocks(input, 'acquire')).rejects.toMatchObject({
      response: { code: 'file_ownership_conflict' },
    });
    expect(tx.supervisorTask.update).not.toHaveBeenCalled();
  });
});
