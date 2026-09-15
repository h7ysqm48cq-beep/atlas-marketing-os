import { ConflictException } from '@nestjs/common';
import type {
  SupervisorExecution,
  SupervisorWorkerRole,
} from '../execution/supervisor-execution.types';
import { PrismaSupervisorExecutionStore } from './prisma-supervisor-execution.store';

function execution(
  overrides: Partial<SupervisorExecution> = {},
): SupervisorExecution {
  return {
    id: 'EXEC-1',
    taskId: 'ATLAS-1',
    workerRole: 'backend',
    status: 'DISPATCHED',
    assignment: {
      executionId: 'EXEC-1',
      taskId: 'ATLAS-1',
      workerRole: 'backend',
      objective: 'Persist execution',
      allowedPaths: ['apps/api/src/agent-supervisor/**'],
      forbiddenActions: ['merge'],
      dependencies: [],
      acceptance: ['execution persists'],
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
    },
    result: null,
    error: null,
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    runnerId: null,
    claimEpoch: 0,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

type ExecutionLivenessFields = {
  runnerId: string | null;
  claimEpoch: number;
  lastHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
};

type ExecutionWithLiveness = SupervisorExecution & ExecutionLivenessFields;

function executionWithLiveness(
  overrides: Partial<ExecutionWithLiveness> = {},
): ExecutionWithLiveness {
  return {
    ...execution(),
    runnerId: 'runner-s2-red',
    claimEpoch: 3,
    lastHeartbeatAt: new Date('2026-09-12T01:02:03.000Z'),
    leaseExpiresAt: new Date('2026-09-12T01:12:03.000Z'),
    ...overrides,
  };
}

type ClaimNextInput = {
  workerRole: SupervisorExecution['workerRole'];
  runnerId: string;
  leaseId: string;
  now: Date;
  leaseExpiresAt: Date;
};

type ClaimNextStore = {
  claimNext(input: ClaimNextInput): Promise<SupervisorExecution | null>;
};

function claimStore(store: PrismaSupervisorExecutionStore): ClaimNextStore {
  return store as unknown as ClaimNextStore;
}

type HeartbeatInput = {
  executionId: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  claimEpoch: number;
  runnerId: string;
  leaseId: string;
  now: Date;
  leaseExpiresAt: Date;
};

type HeartbeatStore = {
  heartbeat(input: HeartbeatInput): Promise<SupervisorExecution | null>;
};

function heartbeatStore(store: PrismaSupervisorExecutionStore): HeartbeatStore {
  return store as unknown as HeartbeatStore;
}

type ReconciliationCandidate = {
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

type ReconciliationStore = {
  findReconciliationCandidates(input: {
    now: Date;
    queuedBefore: Date;
    limit: number;
  }): Promise<ReconciliationCandidate[]>;
};

function reconciliationStore(
  store: PrismaSupervisorExecutionStore,
): ReconciliationStore {
  const candidateStore = store as unknown as Partial<ReconciliationStore>;
  expect(candidateStore.findReconciliationCandidates).toEqual(
    expect.any(Function),
  );
  return candidateStore as ReconciliationStore;
}

function reconciliationCandidate(
  overrides: Partial<ReconciliationCandidate> = {},
): ReconciliationCandidate {
  return {
    executionId: 'EXEC-RECONCILE-1',
    taskId: 'ATLAS-1',
    status: 'QUEUED',
    kind: 'QUEUED_TIMEOUT',
    claimEpoch: 2,
    runnerId: null,
    createdAt: new Date('2026-09-13T00:00:00.000Z'),
    leaseExpiresAt: null,
    ...overrides,
  };
}

function reconciliationTransaction(rows: ReconciliationCandidate[]) {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
  };
  const prisma = mockPrisma();
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  return { prisma, transaction };
}

function heartbeatFixture(): ExecutionWithLiveness {
  return executionWithLiveness({
    id: 'EXEC-HEARTBEAT',
    taskId: 'ATLAS-1',
    status: 'RUNNING',
    runnerId: 'runner-3',
    claimEpoch: 3,
    startedAt: new Date('2026-09-13T00:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-09-13T00:00:20.000Z'),
    leaseExpiresAt: new Date('2026-09-13T00:01:20.000Z'),
    assignment: {
      ...execution().assignment,
      executionId: 'EXEC-HEARTBEAT',
      taskId: 'ATLAS-1',
      workerRole: 'backend',
      manifestHash: 'a'.repeat(64),
      claimEpoch: 3,
      runnerId: 'runner-3',
      leaseId: 'lease-3',
      workerCapability: undefined,
    },
  });
}

function validHeartbeatInput(): HeartbeatInput {
  return {
    executionId: 'EXEC-HEARTBEAT',
    taskId: 'ATLAS-1',
    workerRole: 'backend',
    claimEpoch: 3,
    runnerId: 'runner-3',
    leaseId: 'lease-3',
    now: new Date('2026-09-13T00:00:30.000Z'),
    leaseExpiresAt: new Date('2026-09-13T00:01:30.000Z'),
  };
}

function rawSqlText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(' ');
  if (value && typeof value === 'object') {
    const candidate = value as { raw?: unknown; strings?: unknown };
    if (Array.isArray(candidate.raw)) return candidate.raw.join(' ');
    if (Array.isArray(candidate.strings)) return candidate.strings.join(' ');
  }
  return JSON.stringify(value);
}

function record(value: SupervisorExecution = execution()) {
  return {
    ...value,
    assignment: structuredClone(value.assignment),
    result: value.result === null ? null : structuredClone(value.result),
  };
}

function mockPrisma() {
  return {
    $transaction: jest.fn(),
    supervisorExecution: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('PrismaSupervisorExecutionStore', () => {
  it('creates an execution with all persisted domain fields', async () => {
    const prisma = mockPrisma();
    const input = execution();
    prisma.supervisorExecution.create.mockResolvedValue(record(input));
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.create(input)).resolves.toEqual(input);
    expect(prisma.supervisorExecution.create).toHaveBeenCalledWith({
      data: {
        id: input.id,
        taskId: input.taskId,
        workerRole: input.workerRole,
        status: input.status,
        assignment: input.assignment,
        result: null,
        error: null,
        createdAt: input.createdAt,
        startedAt: null,
        completedAt: null,
        runnerId: null,
        claimEpoch: 0,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
  });

  it('persists liveness fields on create', async () => {
    const prisma = mockPrisma();
    const input = executionWithLiveness();
    prisma.supervisorExecution.create.mockResolvedValue(record(input));
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await store.create(input);

    expect(prisma.supervisorExecution.create).toHaveBeenCalledWith({
      data: {
        id: input.id,
        taskId: input.taskId,
        workerRole: input.workerRole,
        status: input.status,
        assignment: input.assignment,
        result: null,
        error: null,
        createdAt: input.createdAt,
        startedAt: null,
        completedAt: null,
        runnerId: input.runnerId,
        claimEpoch: input.claimEpoch,
        lastHeartbeatAt: input.lastHeartbeatAt,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
  });

  it('returns null when the execution does not exist', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.findUnique.mockResolvedValue(null);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.get('missing')).resolves.toBeNull();
    expect(prisma.supervisorExecution.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
    });
  });

  it('lists executions for a task oldest first', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.findMany.mockResolvedValue([record()]);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.listByTask('ATLAS-1')).resolves.toHaveLength(1);
    expect(prisma.supervisorExecution.findMany).toHaveBeenCalledWith({
      where: { taskId: 'ATLAS-1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('saves mutable execution fields and maps the returned row', async () => {
    const prisma = mockPrisma();
    const input = execution({
      status: 'RUNNING',
      startedAt: new Date('2026-08-30T00:01:00.000Z'),
    });
    prisma.supervisorExecution.update.mockResolvedValue(record(input));
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.save(input)).resolves.toEqual(input);
    expect(prisma.supervisorExecution.update).toHaveBeenCalledWith({
      where: { id: input.id },
      data: {
        taskId: input.taskId,
        workerRole: input.workerRole,
        status: input.status,
        assignment: input.assignment,
        result: input.result,
        error: input.error,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        runnerId: null,
        claimEpoch: 0,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
  });

  it('persists liveness fields on save', async () => {
    const prisma = mockPrisma();
    const input = executionWithLiveness({ status: 'RUNNING' });
    prisma.supervisorExecution.update.mockResolvedValue(record(input));
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await store.save(input);

    expect(prisma.supervisorExecution.update).toHaveBeenCalledWith({
      where: { id: input.id },
      data: {
        taskId: input.taskId,
        workerRole: input.workerRole,
        status: input.status,
        assignment: input.assignment,
        result: input.result,
        error: input.error,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        runnerId: input.runnerId,
        claimEpoch: input.claimEpoch,
        lastHeartbeatAt: input.lastHeartbeatAt,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
  });

  it('atomically saves only when the persisted status matches', async () => {
    const prisma = mockPrisma();
    const input = execution({
      status: 'COMPLETED',
      completedAt: new Date('2026-09-06T00:05:00.000Z'),
    });
    prisma.supervisorExecution.update.mockResolvedValue(record(input));
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.saveIfStatus(input, 'RUNNING')).resolves.toEqual(input);
    expect(prisma.supervisorExecution.update).toHaveBeenCalledWith({
      where: { id: input.id, status: 'RUNNING' },
      data: {
        taskId: input.taskId,
        workerRole: input.workerRole,
        status: input.status,
        assignment: input.assignment,
        result: input.result,
        error: input.error,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        runnerId: null,
        claimEpoch: 0,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
  });

  it('persists liveness fields on saveIfStatus without weakening CAS', async () => {
    const prisma = mockPrisma();
    const input = executionWithLiveness({
      status: 'COMPLETED',
      completedAt: new Date('2026-09-12T01:12:03.000Z'),
    });
    prisma.supervisorExecution.update.mockResolvedValue(record(input));
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await store.saveIfStatus(input, 'RUNNING');

    expect(prisma.supervisorExecution.update).toHaveBeenCalledWith({
      where: { id: input.id, status: 'RUNNING' },
      data: {
        taskId: input.taskId,
        workerRole: input.workerRole,
        status: input.status,
        assignment: input.assignment,
        result: input.result,
        error: input.error,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        runnerId: input.runnerId,
        claimEpoch: input.claimEpoch,
        lastHeartbeatAt: input.lastHeartbeatAt,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
  });

  it('fails closed when a competing transition already changed status', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.update.mockRejectedValue({ code: 'P2025' });
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      store.saveIfStatus(execution({ status: 'COMPLETED' }), 'RUNNING'),
    ).rejects.toMatchObject({
      response: {
        code: 'execution_state_conflict',
        expected: 'RUNNING',
      },
    });
  });

  it('returns cloned assignment data instead of persistence references', async () => {
    const prisma = mockPrisma();
    const persisted = record();
    prisma.supervisorExecution.findUnique.mockResolvedValue(persisted);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    const mapped = await store.get(persisted.id);
    mapped?.assignment.allowedPaths.push('mutated');

    expect(persisted.assignment.allowedPaths).toEqual([
      'apps/api/src/agent-supervisor/**',
    ]);
  });

  it('translates the taskId active-execution unique conflict', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['taskId'] },
    });
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.create(execution())).rejects.toMatchObject({
      response: {
        code: 'active_execution_exists',
        taskId: 'ATLAS-1',
      },
    });
  });

  it('translates Prisma 7 driver-adapter active execution unique metadata', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.create.mockRejectedValue({
      code: 'P2002',
      meta: {
        modelName: 'SupervisorExecution',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage:
              'duplicate key value violates unique constraint "SupervisorExecution_one_active_per_task"',
            kind: 'UniqueConstraintViolation',
            constraint: {
              fields: ['taskId'],
            },
          },
        },
      },
    });
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.create(execution())).rejects.toMatchObject({
      response: {
        code: 'active_execution_exists',
        taskId: 'ATLAS-1',
      },
    });
  });

  it('does not misclassify unrelated unique conflicts as active execution conflicts', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['id'] },
    });
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.create(execution())).rejects.toMatchObject({
      response: { code: 'supervisor_persistence_error' },
    });
  });

  it('wraps unknown database failures as supervisor_persistence_error', async () => {
    const prisma = mockPrisma();
    prisma.supervisorExecution.findMany.mockRejectedValue(
      new Error('database down'),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.listByTask('ATLAS-1')).rejects.toMatchObject({
      response: { code: 'supervisor_persistence_error' },
    });
  });

  it('preserves application ConflictException values', async () => {
    const prisma = mockPrisma();
    const existing = new ConflictException({ code: 'active_execution_exists' });
    prisma.supervisorExecution.create.mockRejectedValue(existing);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(store.create(execution())).rejects.toBe(existing);
  });

  it('claims through one transaction using eligibility ordering and SKIP LOCKED', async () => {
    const prisma = mockPrisma();
    const candidate = execution({
      id: 'EXEC-CLAIM',
      status: 'QUEUED',
      createdAt: new Date('2026-09-13T00:01:00.000Z'),
    });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([record(candidate)]),
      $queryRawUnsafe: jest.fn(),
      supervisorExecution: {
        update: jest.fn().mockResolvedValue(
          record(
            execution({
              ...candidate,
              status: 'RUNNING',
              claimEpoch: 1,
            }),
          ),
        ),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await claimStore(store).claimNext({
      workerRole: 'backend',
      runnerId: 'runner-s4a-claim',
      leaseId: 'lease-s4a-claim',
      now: new Date('2026-09-13T00:03:00.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    const call = transaction.$queryRaw.mock.calls[0] as unknown[];
    const query = `${rawSqlText(call[0])} ${JSON.stringify(call)}`;
    expect(query).toMatch(/SupervisorExecution/i);
    expect(query).toMatch(/SupervisorTask/i);
    expect(query).toMatch(/status/i);
    expect(query).toMatch(/QUEUED/i);
    expect(query).toMatch(/WORKING/i);
    expect(query).toMatch(/workerRole/i);
    expect(query).toMatch(/createdAt/i);
    expect(query).toMatch(/id/i);
    expect(query).toMatch(/FOR UPDATE/i);
    expect(query).toMatch(/SKIP LOCKED/i);
    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('allows verifier claims only while the parent task is VERIFYING', async () => {
    const prisma = mockPrisma();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supervisorExecution: {
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await claimStore(store).claimNext({
      workerRole: 'infra',
      runnerId: 'runner-verifier-claim',
      leaseId: 'lease-verifier-claim',
      now: new Date('2026-09-15T10:30:00.000Z'),
      leaseExpiresAt: new Date('2026-09-15T10:31:00.000Z'),
    });

    const call = transaction.$queryRaw.mock.calls[0] as unknown[];
    const query = `${rawSqlText(call[0])} ${JSON.stringify(call)}`;
    expect(query).toMatch(/executionPurpose/i);
    expect(query).toMatch(/INDEPENDENT_VERIFICATION/i);
    expect(query).toMatch(/VERIFYING/i);
    expect(query).toMatch(/IMPLEMENTATION/i);
    expect(query).toMatch(/WORKING/i);
  });

  it('returns null for no eligible candidate without mutation', async () => {
    const prisma = mockPrisma();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supervisorExecution: {
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      claimStore(store).claimNext({
        workerRole: 'backend',
        runnerId: 'runner-s4a-empty',
        leaseId: 'lease-s4a-empty',
        now: new Date('2026-09-13T00:03:00.000Z'),
        leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
      }),
    ).resolves.toBeNull();
    expect(transaction.supervisorExecution.update).not.toHaveBeenCalled();
  });

  it('increments epoch with a QUEUED status CAS', async () => {
    const prisma = mockPrisma();
    const candidate = execution({
      id: 'EXEC-CAS',
      status: 'QUEUED',
      claimEpoch: 4,
    });
    const claimed = execution({
      ...candidate,
      status: 'RUNNING',
      claimEpoch: 5,
      runnerId: 'runner-s4a-cas',
      startedAt: new Date('2026-09-13T00:03:00.000Z'),
      lastHeartbeatAt: new Date('2026-09-13T00:03:00.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
    });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([record(candidate)]),
      supervisorExecution: {
        update: jest.fn().mockResolvedValue(record(claimed)),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await claimStore(store).claimNext({
      workerRole: 'backend',
      runnerId: 'runner-s4a-cas',
      leaseId: 'lease-s4a-cas',
      now: new Date('2026-09-13T00:03:00.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
    });

    expect(transaction.supervisorExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'EXEC-CAS', status: 'QUEUED' },
        data: expect.objectContaining({ status: 'RUNNING', claimEpoch: 5 }),
      }),
    );
  });

  it('persists claim binding and top-level state atomically', async () => {
    const prisma = mockPrisma();
    const candidate = execution({
      id: 'EXEC-ATOMIC',
      status: 'QUEUED',
      claimEpoch: 2,
      assignment: {
        ...execution().assignment,
        executionId: 'EXEC-ATOMIC',
        manifestHash: 'b'.repeat(64),
        claimEpoch: 2,
        leaseId: 'lease-s4a-old',
        runnerId: 'runner-s4a-old',
        workerCapability: undefined,
      },
    });
    const now = new Date('2026-09-13T00:03:00.000Z');
    const leaseExpiresAt = new Date('2026-09-13T00:13:00.000Z');
    const claimed = execution({
      ...candidate,
      status: 'RUNNING',
      runnerId: 'runner-s4a-atomic',
      claimEpoch: 3,
      startedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt,
      assignment: {
        ...candidate.assignment,
        claimEpoch: 3,
        leaseId: 'lease-s4a-atomic',
        runnerId: 'runner-s4a-atomic',
        workerCapability: undefined,
      },
    });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([record(candidate)]),
      supervisorExecution: {
        update: jest.fn().mockResolvedValue(record(claimed)),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await claimStore(store).claimNext({
      workerRole: 'backend',
      runnerId: 'runner-s4a-atomic',
      leaseId: 'lease-s4a-atomic',
      now,
      leaseExpiresAt,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.supervisorExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'EXEC-ATOMIC', status: 'QUEUED' },
        data: expect.objectContaining({
          status: 'RUNNING',
          runnerId: 'runner-s4a-atomic',
          claimEpoch: 3,
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt,
          assignment: expect.objectContaining({
            executionId: 'EXEC-ATOMIC',
            taskId: 'ATLAS-1',
            workerRole: 'backend',
            manifestHash: 'b'.repeat(64),
            claimEpoch: 3,
            leaseId: 'lease-s4a-atomic',
            runnerId: 'runner-s4a-atomic',
          }),
        }),
      }),
    );
    const update = transaction.supervisorExecution.update.mock.calls[0]?.[0] as
      | { data?: { assignment?: { workerCapability?: unknown } } }
      | undefined;
    expect(update?.data?.assignment?.workerCapability).toBeUndefined();
  });

  it('renews a RUNNING lease through one transaction with exact eligibility filters', async () => {
    const prisma = mockPrisma();
    const candidate = heartbeatFixture();
    const renewed = {
      ...candidate,
      lastHeartbeatAt: validHeartbeatInput().now,
      leaseExpiresAt: validHeartbeatInput().leaseExpiresAt,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([record(candidate)]),
      supervisorExecution: {
        update: jest.fn().mockResolvedValue(record(renewed)),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);
    const heartbeat = heartbeatStore(store).heartbeat;
    expect(heartbeat).toBeDefined();
    if (!heartbeat) return;

    await expect(heartbeat(validHeartbeatInput())).resolves.toMatchObject({
      status: 'RUNNING',
      runnerId: 'runner-3',
      claimEpoch: 3,
      lastHeartbeatAt: validHeartbeatInput().now,
      leaseExpiresAt: validHeartbeatInput().leaseExpiresAt,
      assignment: {
        executionId: 'EXEC-HEARTBEAT',
        taskId: 'ATLAS-1',
        workerRole: 'backend',
        claimEpoch: 3,
        runnerId: 'runner-3',
        leaseId: 'lease-3',
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const query = rawSqlText(transaction.$queryRaw.mock.calls[0]?.[0]);
    expect(query).toMatch(/SupervisorExecution/i);
    expect(query).toMatch(/RUNNING/i);
    expect(query).toMatch(/claimEpoch/i);
    expect(query).toMatch(/runnerId/i);
    expect(query).toMatch(/taskId/i);
    expect(query).toMatch(/workerRole/i);
    expect(query).not.toMatch(/Unsafe/i);
  });

  it('fails closed for absent, ineligible, expired, or stale heartbeat claims without update', async () => {
    const cases: Array<{
      label: string;
      candidate: SupervisorExecution | null;
      input: HeartbeatInput;
    }> = [
      { label: 'absent', candidate: null, input: validHeartbeatInput() },
      {
        label: 'wrong binding',
        candidate: heartbeatFixture(),
        input: { ...validHeartbeatInput(), runnerId: 'other-runner' },
      },
      {
        label: 'expired',
        candidate: heartbeatFixture(),
        input: {
          ...validHeartbeatInput(),
          now: new Date('2026-09-13T00:02:00.000Z'),
        },
      },
      {
        label: 'stale',
        candidate: heartbeatFixture(),
        input: {
          ...validHeartbeatInput(),
          now: new Date('2026-09-13T00:00:10.000Z'),
          leaseExpiresAt: new Date('2026-09-13T00:01:10.000Z'),
        },
      },
    ];

    for (const testCase of cases) {
      const prisma = mockPrisma();
      const transaction = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue(
            testCase.candidate ? [record(testCase.candidate)] : [],
          ),
        supervisorExecution: { update: jest.fn() },
      };
      prisma.$transaction.mockImplementation(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      );
      const store = new PrismaSupervisorExecutionStore(prisma as never);
      const heartbeat = heartbeatStore(store).heartbeat;
      expect(heartbeat).toBeDefined();
      if (!heartbeat) return;

      await expect(heartbeat(testCase.input)).resolves.toBeNull();
      expect(transaction.supervisorExecution.update).not.toHaveBeenCalled();
    }
  });

  it('renews only liveness columns with an exact binding and liveness CAS', async () => {
    const prisma = mockPrisma();
    const candidate = heartbeatFixture();
    const input = validHeartbeatInput();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([record(candidate)]),
      supervisorExecution: {
        update: jest.fn().mockResolvedValue(
          record({
            ...candidate,
            lastHeartbeatAt: input.now,
            leaseExpiresAt: input.leaseExpiresAt,
          }),
        ),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const store = new PrismaSupervisorExecutionStore(prisma as never);
    const heartbeat = heartbeatStore(store).heartbeat;
    expect(heartbeat).toBeDefined();
    if (!heartbeat) return;

    await heartbeat(input);

    expect(transaction.supervisorExecution.update).toHaveBeenCalledTimes(1);
    const update = transaction.supervisorExecution.update.mock.calls[0]?.[0] as {
      where?: Record<string, unknown>;
      data?: Record<string, unknown>;
    };
    expect(update.where).toMatchObject({
      id: 'EXEC-HEARTBEAT',
      status: 'RUNNING',
      claimEpoch: 3,
      runnerId: 'runner-3',
      lastHeartbeatAt: candidate.lastHeartbeatAt,
      leaseExpiresAt: candidate.leaseExpiresAt,
    });
    expect(update.data).toEqual({
      lastHeartbeatAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    });
  });

  it('discovers expired QUEUED executions at the inclusive cutoff', async () => {
    const stale = reconciliationCandidate({
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
    });
    const { prisma, transaction } = reconciliationTransaction([stale]);
    const store = new PrismaSupervisorExecutionStore(prisma as never);
    const input = {
      now: new Date('2026-09-13T00:02:00.000Z'),
      queuedBefore: stale.createdAt,
      limit: 10,
    };

    await expect(
      reconciliationStore(store).findReconciliationCandidates(input),
    ).resolves.toEqual([stale]);

    const query = `${rawSqlText(transaction.$queryRaw.mock.calls[0]?.[0])} ${JSON.stringify(
      transaction.$queryRaw.mock.calls[0],
    )}`;
    expect(query).toMatch(/QUEUED/i);
    expect(query).toMatch(/createdAt/i);
    expect(query).toMatch(/</);
  });

  it('discovers legacy DISPATCHED executions only after the bounded grace cutoff', async () => {
    const stale = reconciliationCandidate({
      status: 'DISPATCHED',
      kind: 'LEGACY_DISPATCHED_TIMEOUT',
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
    });
    const { prisma, transaction } = reconciliationTransaction([stale]);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      reconciliationStore(store).findReconciliationCandidates({
        now: new Date('2026-09-13T00:02:00.000Z'),
        queuedBefore: stale.createdAt,
        limit: 10,
      }),
    ).resolves.toEqual([stale]);

    const query = `${rawSqlText(transaction.$queryRaw.mock.calls[0]?.[0])} ${JSON.stringify(
      transaction.$queryRaw.mock.calls[0],
    )}`;
    expect(query).toMatch(/DISPATCHED/i);
    expect(query).toMatch(/createdAt/i);
  });

  it('discovers RUNNING executions whose lease is expired at now', async () => {
    const stale = reconciliationCandidate({
      status: 'RUNNING',
      kind: 'RUNNING_LEASE_EXPIRED',
      runnerId: 'runner-1',
      leaseExpiresAt: new Date('2026-09-13T00:02:00.000Z'),
    });
    const { prisma, transaction } = reconciliationTransaction([stale]);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      reconciliationStore(store).findReconciliationCandidates({
        now: stale.leaseExpiresAt as Date,
        queuedBefore: new Date('2026-09-12T23:59:00.000Z'),
        limit: 10,
      }),
    ).resolves.toEqual([stale]);

    const query = `${rawSqlText(transaction.$queryRaw.mock.calls[0]?.[0])} ${JSON.stringify(
      transaction.$queryRaw.mock.calls[0],
    )}`;
    expect(query).toMatch(/RUNNING/i);
    expect(query).toMatch(/leaseExpiresAt/i);
    expect(query).toMatch(/</);
  });

  it('never returns terminal executions as reconciliation candidates', async () => {
    const { prisma, transaction } = reconciliationTransaction([]);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      reconciliationStore(store).findReconciliationCandidates({
        now: new Date('2026-09-13T00:02:00.000Z'),
        queuedBefore: new Date('2026-09-13T00:00:00.000Z'),
        limit: 10,
      }),
    ).resolves.toEqual([]);

    const query = `${rawSqlText(transaction.$queryRaw.mock.calls[0]?.[0])} ${JSON.stringify(
      transaction.$queryRaw.mock.calls[0],
    )}`;
    expect(query).toMatch(/QUEUED/i);
    expect(query).toMatch(/DISPATCHED/i);
    expect(query).toMatch(/RUNNING/i);
    expect(query).not.toMatch(/COMPLETED/i);
    expect(query).not.toMatch(/CANCELLED/i);
  });

  it('uses deterministic createdAt/id ordering and a finite positive limit', async () => {
    const rows = [
      reconciliationCandidate(),
      reconciliationCandidate({
        executionId: 'EXEC-RECONCILE-2',
        createdAt: new Date('2026-09-13T00:01:00.000Z'),
      }),
    ];
    const { prisma, transaction } = reconciliationTransaction(rows);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      reconciliationStore(store).findReconciliationCandidates({
        now: new Date('2026-09-13T00:05:00.000Z'),
        queuedBefore: new Date('2026-09-13T00:04:00.000Z'),
        limit: 17,
      }),
    ).resolves.toHaveLength(2);

    const query = `${rawSqlText(transaction.$queryRaw.mock.calls[0]?.[0])} ${JSON.stringify(
      transaction.$queryRaw.mock.calls[0],
    )}`;
    expect(query).toMatch(/ORDER BY/i);
    expect(query).toMatch(/createdAt/i);
    expect(query).toMatch(/id/i);
    expect(query).toMatch(/LIMIT/i);
  });

  it('returns the persisted recovery CAS snapshot without synthesizing state', async () => {
    const candidate = reconciliationCandidate({
      status: 'RUNNING',
      kind: 'RUNNING_LEASE_EXPIRED',
      claimEpoch: 9,
      runnerId: 'runner-reconcile',
      leaseExpiresAt: new Date('2026-09-13T00:01:00.000Z'),
    });
    const { prisma } = reconciliationTransaction([candidate]);
    const store = new PrismaSupervisorExecutionStore(prisma as never);

    await expect(
      reconciliationStore(store).findReconciliationCandidates({
        now: new Date('2026-09-13T00:02:00.000Z'),
        queuedBefore: new Date('2026-09-12T23:59:00.000Z'),
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        executionId: candidate.executionId,
        taskId: candidate.taskId,
        status: candidate.status,
        kind: candidate.kind,
        claimEpoch: candidate.claimEpoch,
        runnerId: candidate.runnerId,
        createdAt: candidate.createdAt,
        leaseExpiresAt: candidate.leaseExpiresAt,
      }),
    ]);
  });
});
