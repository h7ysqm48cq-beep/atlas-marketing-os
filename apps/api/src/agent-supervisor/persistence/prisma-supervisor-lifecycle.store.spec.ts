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
      updateMany: jest.fn(),
      findUnique: jest.fn(),
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
  it('acquires locks and saves the task in one version-checked transaction', async () => {
    const { prisma, tx } = mockPrisma();

    const current = task();

    const input = task({
      updatedAt: new Date(
        current.updatedAt.getTime() + 1,
      ),
    });

    tx.supervisorTask.updateMany
      .mockResolvedValue({ count: 1 });

    tx.supervisorFileLock.findMany
      .mockResolvedValue([]);

    tx.supervisorFileLock.createMany
      .mockResolvedValue({ count: 2 });

    tx.supervisorTask.findUnique
      .mockResolvedValue(
        persistedRecord(input),
      );

    const store =
      new PrismaSupervisorLifecycleStore(
        prisma as never,
      );

    await expect(
      store.saveWithLocksIfUnchanged(
        input,
        'acquire',
        current.updatedAt,
      ),
    ).resolves.toMatchObject({
      id: input.id,
      status: 'WORKING',
    });

    expect(
      tx.supervisorTask.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: input.id,
          updatedAt:
            current.updatedAt,
        },
      }),
    );

    expect(
      tx.supervisorFileLock.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          path: 'apps/api/src/a.ts',
          taskId: 'ATLAS-1',
        },
        {
          path: 'apps/api/src/b.ts',
          taskId: 'ATLAS-1',
        },
      ],
    });
  });

  it('releases owned locks and saves the task in one version-checked transaction', async () => {
    const { prisma, tx } = mockPrisma();

    const current = task({
      status: 'WORKING',
    });

    const input = task({
      status: 'READY_FOR_REVIEW',
      updatedAt: new Date(
        current.updatedAt.getTime() + 1,
      ),
    });

    tx.supervisorTask.updateMany
      .mockResolvedValue({ count: 1 });

    tx.supervisorFileLock.deleteMany
      .mockResolvedValue({ count: 2 });

    tx.supervisorTask.findUnique
      .mockResolvedValue(
        persistedRecord(input),
      );

    const store =
      new PrismaSupervisorLifecycleStore(
        prisma as never,
      );

    await expect(
      store.saveWithLocksIfUnchanged(
        input,
        'release',
        current.updatedAt,
      ),
    ).resolves.toMatchObject({
      status: 'READY_FOR_REVIEW',
    });

    expect(
      tx.supervisorFileLock.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        taskId: 'ATLAS-1',
      },
    });

    expect(
      tx.supervisorTask.updateMany,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects a conflicting lock owner within the version-checked transaction', async () => {
    const { prisma, tx } = mockPrisma();

    const current = task();

    const input = task({
      updatedAt: new Date(
        current.updatedAt.getTime() + 1,
      ),
    });

    tx.supervisorTask.updateMany
      .mockResolvedValue({ count: 1 });

    tx.supervisorFileLock.findMany
      .mockResolvedValue([
        {
          path: 'apps/api/src/a.ts',
          taskId: 'ATLAS-OTHER',
        },
      ]);

    const store =
      new PrismaSupervisorLifecycleStore(
        prisma as never,
      );

    await expect(
      store.saveWithLocksIfUnchanged(
        input,
        'acquire',
        current.updatedAt,
      ),
    ).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(
      tx.supervisorTask.updateMany,
    ).toHaveBeenCalledTimes(1);

    expect(
      tx.supervisorFileLock.createMany,
    ).not.toHaveBeenCalled();

    expect(
      tx.supervisorTask.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('translates Prisma 7 driver-adapter path uniqueness into file ownership conflict', async () => {
    const { prisma, tx } = mockPrisma();

    const current = task();

    const input = task({
      updatedAt: new Date(
        current.updatedAt.getTime() + 1,
      ),
    });

    tx.supervisorTask.updateMany
      .mockResolvedValue({ count: 1 });

    tx.supervisorFileLock.findMany
      .mockResolvedValue([]);

    tx.supervisorFileLock.createMany
      .mockRejectedValue({
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage:
                'duplicate key value violates unique constraint "SupervisorFileLock_pkey"',
              constraint: {
                fields: ['"path"'],
              },
            },
          },
        },
      });

    const store =
      new PrismaSupervisorLifecycleStore(
        prisma as never,
      );

    await expect(
      store.saveWithLocksIfUnchanged(
        input,
        'acquire',
        current.updatedAt,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'file_ownership_conflict',
      },
    });

    expect(
      tx.supervisorTask.updateMany,
    ).toHaveBeenCalledTimes(1);
  });

  it.each(['acquire', 'release'] as const)(
    'rejects stale lifecycle version before %s lock mutation',
    async (mode) => {
      const { prisma, tx } = mockPrisma();

      const current = task();

      const next = task({
        status:
          mode === 'acquire'
            ? 'WORKING'
            : 'READY_FOR_REVIEW',
        updatedAt: new Date(
          current.updatedAt.getTime() + 1,
        ),
      });

      tx.supervisorTask.updateMany.mockResolvedValue({
        count: 0,
      });

      const store =
        new PrismaSupervisorLifecycleStore(
          prisma as never,
        );

      const contract = store as unknown as {
        saveWithLocksIfUnchanged?: (
          task: SupervisorTask,
          mode: 'acquire' | 'release',
          expectedUpdatedAt: Date,
        ) => Promise<SupervisorTask | null>;
      };

      expect(
        contract.saveWithLocksIfUnchanged,
      ).toEqual(expect.any(Function));

      if (!contract.saveWithLocksIfUnchanged) {
        return;
      }

      await expect(
        contract.saveWithLocksIfUnchanged(
          next,
          mode,
          current.updatedAt,
        ),
      ).resolves.toBeNull();

      expect(
        tx.supervisorFileLock.findMany,
      ).not.toHaveBeenCalled();

      expect(
        tx.supervisorFileLock.createMany,
      ).not.toHaveBeenCalled();

      expect(
        tx.supervisorFileLock.deleteMany,
      ).not.toHaveBeenCalled();
    },
  );


  // ASTRA_V2_STORE_CLOSURE_LIFECYCLE_RED
  it('does not expose legacy unconditional saveWithLocks on PrismaSupervisorLifecycleStore', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        PrismaSupervisorLifecycleStore.prototype,
        'saveWithLocks',
      ),
    ).toBe(false);
  });

});
