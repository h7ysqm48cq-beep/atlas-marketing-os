import { ConflictException } from '@nestjs/common';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
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

function execution(overrides: Partial<SupervisorExecution> = {}): SupervisorExecution {
  const now = new Date('2026-09-13T00:00:00.000Z');
  return {
    id: 'EXEC-RECONCILE-1',
    taskId: 'ATLAS-1',
    workerRole: 'backend',
    status: 'RUNNING',
    assignment: {
      executionId: 'EXEC-RECONCILE-1',
      taskId: 'ATLAS-1',
      workerRole: 'backend',
      objective: 'Recover stale execution',
      allowedPaths: ['apps/api/src/agent-supervisor/a.ts'],
      forbiddenActions: ['merge'],
      dependencies: [],
      acceptance: ['execution recovered'],
      requiredEvidence: [
        'rootCause',
        'changedFiles',
        'tests',
        'build',
        'regression',
        'deploymentState',
        'gitState',
        'remainingRisk',
      ],
      manifestHash: 'c'.repeat(64),
      claimEpoch: 4,
      leaseId: 'lease-1',
      runnerId: 'runner-1',
      workerCapability: {
        version: 2,
        assignmentDigest: 'd'.repeat(64),
        allowedActions: ['heartbeat'],
        manifestHash: 'c'.repeat(64),
        allowedPaths: ['apps/api/src/agent-supervisor/a.ts'],
        forbiddenActions: ['merge'],
        claimEpoch: 4,
        leaseId: 'lease-1',
        runnerId: 'runner-1',
        jti: 'jti-1',
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      },
    },
    result: null,
    error: null,
    createdAt: new Date('2026-09-12T23:00:00.000Z'),
    startedAt: new Date('2026-09-12T23:30:00.000Z'),
    completedAt: null,
    runnerId: 'runner-1',
    claimEpoch: 4,
    lastHeartbeatAt: new Date('2026-09-13T00:00:00.000Z'),
    leaseExpiresAt: new Date('2026-09-12T23:59:00.000Z'),
    ...overrides,
  };
}

type RecoveryCandidate = {
  executionId: string;
  taskId: string;
  status: 'QUEUED' | 'DISPATCHED' | 'RUNNING';
  kind:
    | 'QUEUED_TIMEOUT'
    | 'LEGACY_DISPATCHED_TIMEOUT'
    | 'RUNNING_LEASE_EXPIRED';
  claimEpoch: number;
  runnerId: string | null;
  createdAt: Date;
  leaseExpiresAt: Date | null;
};

type RecoveryStore = {
  recoverExecutionAndBlockTask(input: {
    candidate: RecoveryCandidate;
    now: Date;
  }): Promise<{ execution: SupervisorExecution; task: SupervisorTask } | null>;
};

function recoveryStore(store: PrismaSupervisorLifecycleStore): RecoveryStore {
  const candidateStore = store as unknown as Partial<RecoveryStore>;
  expect(candidateStore.recoverExecutionAndBlockTask).toEqual(
    expect.any(Function),
  );
  return candidateStore as RecoveryStore;
}

function recoveryCandidate(
  overrides: Partial<RecoveryCandidate> = {},
): RecoveryCandidate {
  return {
    executionId: 'EXEC-RECONCILE-1',
    taskId: 'ATLAS-1',
    status: 'RUNNING',
    kind: 'RUNNING_LEASE_EXPIRED',
    claimEpoch: 4,
    runnerId: 'runner-1',
    createdAt: new Date('2026-09-12T23:00:00.000Z'),
    leaseExpiresAt: new Date('2026-09-12T23:59:00.000Z'),
    ...overrides,
  };
}

function recoveryTransaction() {
  const transaction = {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    supervisorExecution: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    supervisorTask: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    supervisorFileLock: {
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    ),
  };
  return { prisma, transaction };
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
    supervisorExecution: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
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

  it('atomically fails the stale execution, blocks the task, and releases its locks', async () => {
    const { prisma, transaction } = recoveryTransaction();
    const candidate = recoveryCandidate();
    const now = new Date('2026-09-13T00:02:00.000Z');
    transaction.supervisorExecution.findUnique.mockResolvedValue(
      execution(),
    );
    transaction.supervisorTask.findUnique.mockResolvedValue(task());
    transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    const recovered = await recoveryStore(store).recoverExecutionAndBlockTask({
      candidate,
      now,
    });

    expect(recovered).toMatchObject({
      execution: {
        id: candidate.executionId,
        status: 'FAILED',
        completedAt: now,
        error: 'supervisor_execution_lease_expired',
      },
      task: {
        id: candidate.taskId,
        status: 'BLOCKED',
        blockingReason: 'supervisor_execution_lease_expired',
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.supervisorFileLock.deleteMany).toHaveBeenCalledWith({
      where: { taskId: candidate.taskId },
    });
  });

  it('recovers an expired independent verifier while the parent task is VERIFYING', async () => {
    const { prisma, transaction } = recoveryTransaction();
    const current = execution({
      assignment: {
        ...execution().assignment,
        executionPurpose: 'INDEPENDENT_VERIFICATION',
      },
    });
    const candidate = recoveryCandidate();
    const now = new Date('2026-09-13T00:02:00.000Z');
    transaction.supervisorExecution.findUnique.mockResolvedValue(current);
    transaction.supervisorTask.findUnique.mockResolvedValue(
      task({ status: 'VERIFYING' }),
    );
    transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    const recovered = await recoveryStore(store).recoverExecutionAndBlockTask({
      candidate,
      now,
    });

    expect(recovered).toMatchObject({
      execution: {
        id: candidate.executionId,
        status: 'FAILED',
        error: 'supervisor_execution_lease_expired',
      },
      task: {
        id: candidate.taskId,
        status: 'BLOCKED',
        blockingReason: 'supervisor_execution_lease_expired',
      },
    });
    expect(transaction.supervisorTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: candidate.taskId,
        status: 'VERIFYING',
      },
      data: expect.objectContaining({
        status: 'BLOCKED',
      }),
    });
    expect(transaction.supervisorFileLock.deleteMany).toHaveBeenCalledWith({
      where: { taskId: candidate.taskId },
    });
  });

  it('does not recover an implementation execution while the parent task is VERIFYING', async () => {
    const { prisma, transaction } = recoveryTransaction();
    transaction.supervisorExecution.findUnique.mockResolvedValue(
      execution({
        assignment: {
          ...execution().assignment,
          executionPurpose: 'IMPLEMENTATION',
        },
      }),
    );
    transaction.supervisorTask.findUnique.mockResolvedValue(
      task({ status: 'VERIFYING' }),
    );

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await expect(
      recoveryStore(store).recoverExecutionAndBlockTask({
        candidate: recoveryCandidate(),
        now: new Date('2026-09-13T00:02:00.000Z'),
      }),
    ).resolves.toBeNull();
    expect(transaction.supervisorExecution.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['APPROVED', 'FAILED'] as const)(
    'terminalizes a stale execution without mutating an already %s parent task',
    async (status) => {
      const { prisma, transaction } = recoveryTransaction();
      const currentExecution = execution();
      const currentTask = task({ status });
      const candidate = recoveryCandidate();
      const now = new Date('2026-09-13T00:02:00.000Z');
      transaction.supervisorExecution.findUnique.mockResolvedValue(
        currentExecution,
      );
      transaction.supervisorTask.findUnique.mockResolvedValue(currentTask);
      transaction.supervisorExecution.updateMany.mockResolvedValue({
        count: 1,
      });

      const store = new PrismaSupervisorLifecycleStore(prisma as never);
      const recovered =
        await recoveryStore(store).recoverExecutionAndBlockTask({
          candidate,
          now,
        });

      expect(recovered).toMatchObject({
        execution: {
          id: candidate.executionId,
          status: 'FAILED',
          error: 'supervisor_execution_lease_expired',
          runnerId: null,
          claimEpoch: currentExecution.claimEpoch + 1,
        },
        task: {
          id: currentTask.id,
          status,
          updatedAt: currentTask.updatedAt,
        },
      });
      expect(transaction.supervisorExecution.updateMany).toHaveBeenCalledTimes(
        1,
      );
      expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
      expect(
        transaction.supervisorFileLock.deleteMany,
      ).not.toHaveBeenCalled();
    },
  );

  it('invalidates the old claim while preserving the execution audit envelope', async () => {
    const { prisma, transaction } = recoveryTransaction();
    const current = execution();
    const candidate = recoveryCandidate({ claimEpoch: current.claimEpoch });
    const now = new Date('2026-09-13T00:02:00.000Z');
    transaction.supervisorExecution.findUnique.mockResolvedValue(current);
    transaction.supervisorTask.findUnique.mockResolvedValue(task());
    transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    const recovered = await recoveryStore(store).recoverExecutionAndBlockTask({
      candidate,
      now,
    });

    expect(recovered?.execution).toMatchObject({
      claimEpoch: current.claimEpoch + 1,
      runnerId: null,
      leaseExpiresAt: null,
      startedAt: current.startedAt,
      lastHeartbeatAt: current.lastHeartbeatAt,
      assignment: {
        claimEpoch: current.claimEpoch + 1,
        workerCapability: undefined,
      },
    });
    expect(recovered?.execution.assignment.runnerId).toBeUndefined();
    expect(recovered?.execution.assignment.leaseId).toBeUndefined();
  });

  it('does not overwrite a completion that wins the recovery race', async () => {
    const { prisma, transaction } = recoveryTransaction();
    const candidate = recoveryCandidate();
    transaction.supervisorExecution.findUnique.mockResolvedValue(
      execution({
        status: 'COMPLETED',
        completedAt: new Date('2026-09-13T00:01:30.000Z'),
      }),
    );
    transaction.supervisorTask.findUnique.mockResolvedValue(task());

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await expect(
      recoveryStore(store).recoverExecutionAndBlockTask({
        candidate,
        now: new Date('2026-09-13T00:02:00.000Z'),
      }),
    ).resolves.toBeNull();
    expect(transaction.supervisorExecution.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ['status', execution({ status: 'RUNNING', claimEpoch: 5 })],
    ['claimEpoch', execution({ claimEpoch: 5 })],
    ['runnerId', execution({ runnerId: 'other-runner' })],
    [
      'leaseExpiresAt',
      execution({ leaseExpiresAt: new Date('2026-09-13T00:00:00.000Z') }),
    ],
  ] as const)('fails closed when the stale %s snapshot no longer matches', async (_label, current) => {
    const { prisma, transaction } = recoveryTransaction();
    const candidate = recoveryCandidate();
    transaction.supervisorExecution.findUnique.mockResolvedValue(current);
    transaction.supervisorTask.findUnique.mockResolvedValue(task());

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await expect(
      recoveryStore(store).recoverExecutionAndBlockTask({
        candidate,
        now: new Date('2026-09-13T00:02:00.000Z'),
      }),
    ).resolves.toBeNull();
    expect(transaction.supervisorExecution.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['BLOCKED', 'COMPLETED', 'CANCELLED'] as const)(
    'does not recover a task that is already %s',
    async (status) => {
      const { prisma, transaction } = recoveryTransaction();
      transaction.supervisorExecution.findUnique.mockResolvedValue(execution());
      transaction.supervisorTask.findUnique.mockResolvedValue(
        task({ status: status as SupervisorTask['status'] }),
      );

      const store = new PrismaSupervisorLifecycleStore(prisma as never);
      await expect(
        recoveryStore(store).recoverExecutionAndBlockTask({
          candidate: recoveryCandidate(),
          now: new Date('2026-09-13T00:02:00.000Z'),
        }),
      ).resolves.toBeNull();
      expect(transaction.supervisorExecution.updateMany).not.toHaveBeenCalled();
      expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
      expect(transaction.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('is idempotent when the same stale recovery input is replayed', async () => {
    const { prisma, transaction } = recoveryTransaction();
    const candidate = recoveryCandidate();
    const now = new Date('2026-09-13T00:02:00.000Z');
    transaction.supervisorExecution.findUnique
      .mockResolvedValueOnce(execution())
      .mockResolvedValueOnce(
        execution({
          status: 'FAILED',
          claimEpoch: 5,
          runnerId: null,
          leaseExpiresAt: null,
          completedAt: now,
          error: 'supervisor_execution_lease_expired',
        }),
      );
    transaction.supervisorTask.findUnique
      .mockResolvedValueOnce(task())
      .mockResolvedValueOnce(task({ status: 'BLOCKED' }));
    transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    const contract = recoveryStore(store);
    await expect(contract.recoverExecutionAndBlockTask({ candidate, now })).resolves.toBeTruthy();
    await expect(contract.recoverExecutionAndBlockTask({ candidate, now })).resolves.toBeNull();
    expect(transaction.supervisorExecution.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.supervisorTask.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.supervisorFileLock.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('uses one database transaction with row locks and no unsafe raw SQL', async () => {
    const { prisma, transaction } = recoveryTransaction();
    transaction.$queryRaw.mockResolvedValue([execution()]);
    transaction.supervisorExecution.findUnique.mockResolvedValue(execution());
    transaction.supervisorTask.findUnique.mockResolvedValue(task());
    transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });

    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await recoveryStore(store).recoverExecutionAndBlockTask({
      candidate: recoveryCandidate(),
      now: new Date('2026-09-13T00:02:00.000Z'),
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const query = `${String(transaction.$queryRaw.mock.calls[0]?.[0])} ${JSON.stringify(
      transaction.$queryRaw.mock.calls[0],
    )}`;
    expect(query).toMatch(/FOR UPDATE/i);
    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

});

// S7_HUMAN_OWNER_ABORT_RED_RECOVERY
type OwnerAbortRecoveryInput = {
  source: 'HUMAN_OWNER_ABORT';
  taskId: string;
  reason: string;
  now: Date;
};

function ownerAbortInput(
  overrides: Partial<OwnerAbortRecoveryInput> = {},
): OwnerAbortRecoveryInput {
  return {
    source: 'HUMAN_OWNER_ABORT',
    taskId: 'ATLAS-1',
    reason: 'superseded implementation',
    now: new Date('2026-09-13T00:02:00.000Z'),
    ...overrides,
  };
}

function dynamicRecovery(store: PrismaSupervisorLifecycleStore) {
  return store as unknown as {
    recoverExecutionAndBlockTask: (
      input: unknown,
    ) => Promise<{ execution: SupervisorExecution; task: SupervisorTask } | null>;
  };
}

async function invokeOwnerAbort(
  store: PrismaSupervisorLifecycleStore,
  input: OwnerAbortRecoveryInput,
) {
  try {
    return await dynamicRecovery(store).recoverExecutionAndBlockTask(input);
  } catch {
    return undefined;
  }
}

function configureOwnerAbortTransaction(
  status: SupervisorExecution['status'] = 'RUNNING',
) {
  const { prisma, transaction } = recoveryTransaction();
  const current = execution({ status });
  transaction.$queryRaw.mockResolvedValue([current]);
  transaction.supervisorExecution.findUnique.mockResolvedValue(current);
  transaction.supervisorTask.findUnique.mockResolvedValue(task());
  transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
  transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
  transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });
  return { prisma, transaction, current };
}

describe('S7 Human Owner abort RED recovery contract', () => {
  it('RED 9 evolves the S6 recovery input additively', async () => {
    const { prisma, transaction } = configureOwnerAbortTransaction();
    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    const contract = dynamicRecovery(store);

    await expect(
      contract.recoverExecutionAndBlockTask({
        candidate: recoveryCandidate(),
        now: new Date('2026-09-13T00:02:00.000Z'),
      }),
    ).resolves.toBeTruthy();

    const ownerResult = await invokeOwnerAbort(store, ownerAbortInput());
    expect(ownerResult).not.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('RED 10 selects and row-locks the current active execution inside the transaction', async () => {
    const { prisma, transaction } = configureOwnerAbortTransaction();
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    await invokeOwnerAbort(store, ownerAbortInput());

    expect(transaction.$queryRaw).toHaveBeenCalled();
    const query = transaction.$queryRaw.mock.calls
      .map((call) => String(call[0]))
      .join(' ');
    expect(query).toMatch(/FOR UPDATE/i);
    expect(query).toMatch(/QUEUED|DISPATCHED|RUNNING/i);
    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('RED 11 returns null and performs no mutation when no active execution exists', async () => {
    const { prisma, transaction } = recoveryTransaction();
    transaction.$queryRaw.mockResolvedValue([]);
    transaction.supervisorExecution.findUnique.mockResolvedValue(null);
    transaction.supervisorTask.findUnique.mockResolvedValue(task());
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    const result = await invokeOwnerAbort(store, ownerAbortInput());
    expect(result).toBeNull();
    expect(transaction.supervisorExecution.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorFileLock.deleteMany).not.toHaveBeenCalled();
  });

  it('RED 12 terminalizes the current execution as CANCELLED with the abort reason', async () => {
    const { prisma, transaction } = configureOwnerAbortTransaction('RUNNING');
    const now = new Date('2026-09-13T00:02:00.000Z');
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    const result = await invokeOwnerAbort(store, ownerAbortInput({ now }));
    expect(result?.execution).toMatchObject({
      status: 'CANCELLED',
      completedAt: now,
      error: 'supervisor_execution_owner_abort:superseded implementation',
    });
  });

  it('RED 13 invalidates the worker claim while preserving historical timestamps', async () => {
    const { prisma, transaction, current } = configureOwnerAbortTransaction('RUNNING');
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    const result = await invokeOwnerAbort(store, ownerAbortInput());
    expect(result?.execution).toMatchObject({
      claimEpoch: current.claimEpoch + 1,
      runnerId: null,
      leaseExpiresAt: null,
      startedAt: current.startedAt,
      lastHeartbeatAt: current.lastHeartbeatAt,
      assignment: {
        claimEpoch: current.claimEpoch + 1,
        workerCapability: undefined,
      },
    });
    expect(result?.execution.assignment.runnerId).toBeUndefined();
    expect(result?.execution.assignment.leaseId).toBeUndefined();
  });

  it('RED 14 blocks the task and releases only its locks in the same transaction', async () => {
    const { prisma, transaction } = configureOwnerAbortTransaction('RUNNING');
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    const result = await invokeOwnerAbort(store, ownerAbortInput());
    expect(result?.task).toMatchObject({
      status: 'BLOCKED',
      blockingReason: 'supervisor_execution_owner_abort:superseded implementation',
    });
    expect(transaction.supervisorFileLock.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 'ATLAS-1' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('RED 15 preserves a completion race winner and makes repeated abort idempotent', async () => {
    const { prisma, transaction } = recoveryTransaction();
    const now = new Date('2026-09-13T00:02:00.000Z');
    transaction.$queryRaw.mockResolvedValue([execution({ status: 'COMPLETED', completedAt: now })]);
    transaction.supervisorExecution.findUnique.mockResolvedValue(
      execution({ status: 'COMPLETED', completedAt: now }),
    );
    transaction.supervisorTask.findUnique.mockResolvedValue(task());
    const store = new PrismaSupervisorLifecycleStore(prisma as never);

    const raceResult = await invokeOwnerAbort(store, ownerAbortInput({ now }));
    expect(raceResult).toBeNull();
    expect(transaction.supervisorExecution.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(transaction.supervisorFileLock.deleteMany).not.toHaveBeenCalled();

    transaction.$queryRaw.mockResolvedValue([execution()]);
    transaction.supervisorExecution.findUnique
      .mockResolvedValueOnce(execution())
      .mockResolvedValueOnce(execution({
        status: 'CANCELLED',
        claimEpoch: 5,
        runnerId: null,
        leaseExpiresAt: null,
        completedAt: now,
        error: 'supervisor_execution_owner_abort:superseded implementation',
      }));
    transaction.supervisorTask.findUnique
      .mockResolvedValueOnce(task())
      .mockResolvedValueOnce(task({ status: 'BLOCKED' }));
    transaction.supervisorExecution.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorTask.updateMany.mockResolvedValue({ count: 1 });
    transaction.supervisorFileLock.deleteMany.mockResolvedValue({ count: 1 });

    await expect(invokeOwnerAbort(store, ownerAbortInput({ now }))).not.toBeNull();
    const second = await invokeOwnerAbort(store, ownerAbortInput({ now }));
    expect(second).toBeNull();
    expect(transaction.supervisorExecution.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.supervisorTask.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.supervisorFileLock.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('Existing-candidate admission atomic DB boundary', () => {
  const valid = () => {
    const original = task({ status: 'DRAFT', evidence: null });
    const old = execution();
    const queued = execution({
      id: 'ATLAS-EXEC-EXACT-1', status: 'QUEUED',
      taskId: original.id, workerRole: original.owner,
      startedAt: null, completedAt: null, runnerId: null,
      claimEpoch: 0, lastHeartbeatAt: null, leaseExpiresAt: null,
      result: null, error: null,
      assignment: {
        ...old.assignment,
        executionId: 'ATLAS-EXEC-EXACT-1',
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        verificationMode: 'EXISTING_CANDIDATE',
        candidateBaseSha: 'a'.repeat(40),
        candidateHeadSha: 'b'.repeat(40),
        productionBaselineSha: 'a'.repeat(40),
        allowedPaths: [...original.allowedPaths],
        workerRole: original.owner,
      },
    });
    return { original, queued };
  };

  it('persists CAS VERIFYING, exact locks and queued verifier in one transaction', async () => {
    const { original, queued } = valid();
    const { prisma, tx } = mockPrisma();
    const calls: string[] = [];
    (tx as any).$queryRaw = jest.fn(async () => []);
    tx.supervisorTask.updateMany.mockImplementation(async () => {
      calls.push('task-CAS'); return { count: 1 };
    });
    tx.supervisorFileLock.findMany.mockResolvedValue([]);
    tx.supervisorFileLock.createMany.mockImplementation(async () => {
      calls.push('locks'); return { count: 2 };
    });
    (tx.supervisorExecution as any).create = jest.fn(async ({ data }: any) => {
      calls.push('execution'); return data;
    });
    tx.supervisorTask.findUnique.mockImplementation(async () =>
      persistedRecord(task({ ...original, status: 'VERIFYING',
        updatedAt: new Date(original.updatedAt.getTime()+1) })),
    );
    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    const result = await store.admitExistingCandidateAndQueue(original, queued);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['task-CAS', 'locks', 'execution']);
    expect(result?.task.status).toBe('VERIFYING');
    expect(result?.execution.status).toBe('QUEUED');
    expect((tx.supervisorExecution as any).create).toHaveBeenCalledTimes(1);
  });

  it('fails closed when DRAFT has any earlier execution; no CAS or locks', async () => {
    const { original, queued } = valid();
    const { prisma, tx } = mockPrisma();
    (tx as any).$queryRaw = jest.fn(async () =>
      [{ id: 'old', status: 'FAILED', purpose: 'IMPLEMENTATION' }]);
    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await expect(store.admitExistingCandidateAndQueue(original, queued))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
    expect(tx.supervisorFileLock.createMany).not.toHaveBeenCalled();
  });

  it('fails version CAS without creating an execution or acquiring locks', async () => {
    const { original, queued } = valid();
    const { prisma, tx } = mockPrisma();
    (tx as any).$queryRaw = jest.fn(async () => []);
    tx.supervisorTask.updateMany.mockResolvedValue({ count: 0 });
    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await expect(store.admitExistingCandidateAndQueue(original, queued))
      .resolves.toBeNull();
    expect(tx.supervisorFileLock.findMany).not.toHaveBeenCalled();
    expect((tx.supervisorExecution as any).create).toBeUndefined();
  });

  it('rejects a synthetic implementation result instead of queueing', async () => {
    const { original, queued } = valid();
    const { prisma, tx } = mockPrisma();
    const store = new PrismaSupervisorLifecycleStore(prisma as never);
    await expect(store.admitExistingCandidateAndQueue(original, {
      ...queued, assignment: {
        ...queued.assignment, executionPurpose: 'IMPLEMENTATION',
      },
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.supervisorTask.updateMany).not.toHaveBeenCalled();
  });
});
