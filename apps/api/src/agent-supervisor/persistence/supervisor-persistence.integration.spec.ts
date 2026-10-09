import { ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { PrismaFileOwnershipStore } from './prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './prisma-supervisor-execution.store';
import { PrismaSupervisorLifecycleStore } from './prisma-supervisor-lifecycle.store';
import { PrismaSupervisorTaskStore } from './prisma-supervisor-task.store';

const databaseUrl = process.env.SUPERVISOR_INTEGRATION_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

type DeleteManyDelegate = {
  deleteMany(): Promise<unknown>;
};

type SupervisorCleanupPrisma = {
  supervisorFileLock: DeleteManyDelegate;
  supervisorExecution: DeleteManyDelegate;
  supervisorTask: DeleteManyDelegate;
};

describeIntegration('Supervisor Prisma persistence integration', () => {
  let prisma: PrismaClient;
  let taskStore: PrismaSupervisorTaskStore;
  let executionStore: PrismaSupervisorExecutionStore;
  let fileStore: PrismaFileOwnershipStore;
  let lifecycleStore: PrismaSupervisorLifecycleStore;

  beforeAll(async () => {
    const adapter = new PrismaPg({
      connectionString: databaseUrl!,
      max: 2,
    });
    prisma = new PrismaClient({ adapter });
    const prismaService = prisma as unknown as PrismaService;
    taskStore = new PrismaSupervisorTaskStore(prismaService);
    executionStore = new PrismaSupervisorExecutionStore(prismaService);
    fileStore = new PrismaFileOwnershipStore(prismaService);
    lifecycleStore = new PrismaSupervisorLifecycleStore(prismaService);
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    const cleanupPrisma = prisma as unknown as SupervisorCleanupPrisma;
    await cleanupPrisma.supervisorFileLock.deleteMany();
    await cleanupPrisma.supervisorExecution.deleteMany();
    await cleanupPrisma.supervisorTask.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function task(overrides: Partial<SupervisorTask> = {}): SupervisorTask {
    const now = new Date();
    return {
      id: `ATLAS-TEST-${randomUUID()}`,
      objective: 'Verify persisted supervisor task',
      owner: 'backend',
      status: 'DRAFT',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['persists'],
      evidence: null,
      blockingReason: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function execution(
    taskId: string,
    status: SupervisorExecution['status'] = 'DISPATCHED',
  ): SupervisorExecution {
    const id = `ATLAS-EXEC-TEST-${randomUUID()}`;
    return {
      id,
      taskId,
      workerRole: 'backend',
      status,
      assignment: {
        executionId: id,
        taskId,
        workerRole: 'backend',
        objective: 'Verify persisted execution',
        allowedPaths: ['apps/api/src/example.ts'],
        forbiddenActions: ['merge'],
        dependencies: [],
        acceptance: ['persists'],
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
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      runnerId: null,
      claimEpoch: 0,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
    };
  }

  it('persists tasks across fresh store instances', async () => {
    const created = await taskStore.create(task());
    const restartedStore = new PrismaSupervisorTaskStore(
      prisma as unknown as PrismaService,
    );

    const loaded = await restartedStore.get(created.id);

    expect(loaded).toMatchObject({
      id: created.id,
      objective: created.objective,
      owner: 'backend',
      status: 'DRAFT',
    });
    expect(loaded?.createdAt).toBeInstanceOf(Date);
  });

  it('persists an executor dispatch reservation across independent Prisma clients and rejects a stale writer', async () => {
    const candidate = {
      action: 'deploy_production' as const,
      targetBranch: 'production/atlas' as const,
      baseSha: 'a'.repeat(40),
      headSha: 'a'.repeat(40),
      changedFiles: [] as string[],
    };
    const reservation = {
      candidate,
      service: 'production-deploy-executor' as const,
      reservationId: 'ATLAS-DISPATCH-' + 'd'.repeat(64),
      reservedBy: 'atlas-production-deploy-executor:production-deploy-executor',
      reservedAt: '2026-10-07T06:00:00.000Z',
    };
    const created = await taskStore.create(
      task({
        status: 'APPROVED',
        evidence: {
          rootCause: 'independent deployment qualification',
          changedFiles: [],
          tests: ['integration reservation persistence'],
          build: 'NOT_RUN',
          regression: [],
          deploymentState: 'NOT_DEPLOYED',
          gitState: 'CLEAN',
          remainingRisk: [],
          reviewCandidate: candidate,
        },
      }),
    );

    const secondAdapter = new PrismaPg({
      connectionString: databaseUrl!,
      max: 1,
    });
    const secondPrisma = new PrismaClient({ adapter: secondAdapter });
    const secondStore = new PrismaSupervisorTaskStore(
      secondPrisma as unknown as PrismaService,
    );

    try {
      const staleSnapshot = await secondStore.get(created.id);
      expect(staleSnapshot).not.toBeNull();
      if (!staleSnapshot?.evidence) {
        throw new Error('expected persisted task evidence');
      }

      const reservedTask: SupervisorTask = {
        ...created,
        updatedAt: new Date(created.updatedAt.getTime() + 1),
        evidence: {
          ...created.evidence!,
          ownerDeploymentDispatchReservation: reservation,
        },
      };
      await expect(
        taskStore.saveIfUnchanged(reservedTask, created.updatedAt),
      ).resolves.toMatchObject({
        evidence: {
          ownerDeploymentDispatchReservation: reservation,
        },
      });

      const reloaded = await secondStore.get(created.id);
      expect(reloaded?.evidence?.ownerDeploymentDispatchReservation).toEqual(
        reservation,
      );

      await expect(
        secondStore.saveIfUnchanged(
          {
            ...staleSnapshot,
            updatedAt: new Date(staleSnapshot.updatedAt.getTime() + 2),
          },
          staleSnapshot.updatedAt,
        ),
      ).resolves.toBeNull();

      const intact = await taskStore.get(created.id);
      expect(intact?.evidence?.ownerDeploymentDispatchReservation).toEqual(
        reservation,
      );
    } finally {
      await secondPrisma.$disconnect();
    }
  });

  it('enforces one active execution per task at the database boundary', async () => {
    const persistedTask = await taskStore.create(task());
    await executionStore.create(execution(persistedTask.id, 'DISPATCHED'));

    await expect(
      executionStore.create(execution(persistedTask.id, 'RUNNING')),
    ).rejects.toMatchObject({
      response: {
        code: 'active_execution_exists',
        taskId: persistedTask.id,
      },
    });
  });

  it('allows a retry after the previous execution becomes terminal', async () => {
    const persistedTask = await taskStore.create(task());
    const first = await executionStore.create(
      execution(persistedTask.id, 'DISPATCHED'),
    );
    first.status = 'FAILED';
    first.error = 'expected integration failure';
    first.completedAt = new Date();
    await executionStore.save(first);

    const retry = await executionStore.create(
      execution(persistedTask.id, 'DISPATCHED'),
    );

    expect(retry.status).toBe('DISPATCHED');
    expect(await executionStore.listByTask(persistedTask.id)).toHaveLength(2);
  });

  it('enforces one owner per mutable path and releases only owned locks', async () => {
    const firstTask = await taskStore.create(task());
    const secondTask = await taskStore.create(
      task({ allowedPaths: ['apps/api/src/other.ts'] }),
    );
    const path = 'apps/api/src/shared.ts';

    await fileStore.acquire(firstTask.id, [path]);
    await expect(fileStore.acquire(secondTask.id, [path])).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await fileStore.findOwner(path)).toBe(firstTask.id);

    await fileStore.release(secondTask.id);
    expect(await fileStore.findOwner(path)).toBe(firstTask.id);

    await fileStore.release(firstTask.id);
    expect(await fileStore.findOwner(path)).toBeNull();
  });

  it('commits task state and file locks together for lifecycle acquire', async () => {
    const persistedTask = await taskStore.create(task());
    const workingTask: SupervisorTask = {
      ...persistedTask,
      status: 'WORKING',
      updatedAt: new Date(),
    };

    const saved =
      await lifecycleStore.saveWithLocksIfUnchanged(
        workingTask,
        'acquire',
        persistedTask.updatedAt,
      );

    expect(saved).not.toBeNull();

    if (!saved) {
      throw new Error(
        'expected lifecycle acquire CAS to succeed',
      );
    }

    expect(saved.status).toBe('WORKING');
    expect((await taskStore.get(persistedTask.id))?.status).toBe('WORKING');
    expect(await fileStore.findOwner('apps/api/src/example.ts')).toBe(
      persistedTask.id,
    );
  });

  it('rolls back task state when lifecycle lock acquisition conflicts', async () => {
    const firstTask = await taskStore.create(
      task({ allowedPaths: ['apps/api/src/shared.ts'] }),
    );
    const secondTask = await taskStore.create(
      task({ allowedPaths: ['apps/api/src/shared.ts'] }),
    );
    await fileStore.acquire(firstTask.id, ['apps/api/src/shared.ts']);
    const attemptedWorkingTask: SupervisorTask = {
      ...secondTask,
      status: 'WORKING',
      updatedAt: new Date(),
    };

    await expect(
      lifecycleStore.saveWithLocksIfUnchanged(
        attemptedWorkingTask,
        'acquire',
        secondTask.updatedAt,
      ),
    ).rejects.toMatchObject({
      response: { code: 'file_ownership_conflict' },
    });

    expect((await taskStore.get(secondTask.id))?.status).toBe('DRAFT');
    expect(await fileStore.findOwner('apps/api/src/shared.ts')).toBe(firstTask.id);
  });

  it('commits task state and lock release together for lifecycle release', async () => {
    const persistedTask = await taskStore.create(
      task({ status: 'WORKING' }),
    );
    await fileStore.acquire(persistedTask.id, persistedTask.allowedPaths);
    const readyTask: SupervisorTask = {
      ...persistedTask,
      status: 'READY_FOR_REVIEW',
      updatedAt: new Date(),
    };

    const saved =
      await lifecycleStore.saveWithLocksIfUnchanged(
        readyTask,
        'release',
        persistedTask.updatedAt,
      );

    expect(saved).not.toBeNull();

    if (!saved) {
      throw new Error(
        'expected lifecycle release CAS to succeed',
      );
    }

    expect(saved.status).toBe('READY_FOR_REVIEW');
    expect((await taskStore.get(persistedTask.id))?.status).toBe(
      'READY_FOR_REVIEW',
    );
    expect(await fileStore.findOwner('apps/api/src/example.ts')).toBeNull();
  });
});
