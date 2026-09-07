import { ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { SupervisorRunnerClaimService } from '../runner/supervisor-runner-claim.service';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
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
  let runnerClaims: SupervisorRunnerClaimService;

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
    runnerClaims = new SupervisorRunnerClaimService(
      prismaService,
      new SupervisorWorkerCapabilityService({
        get: (name: string) =>
          name === 'ATLAS_SUPERVISOR_OWNER_TOKEN'
            ? 'local-integration-only-capability-key'
            : undefined,
      } as never),
    );
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
      claimedBy: null,
      claimEpoch: 0,
      claimedAt: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
  }

  function claimableExecution(
    taskId: string,
    overrides: Partial<SupervisorExecution> = {},
  ): SupervisorExecution {
    const value = execution(taskId, 'DISPATCHED');
    return {
      ...value,
      assignment: {
        ...value.assignment,
        executionPurpose: 'IMPLEMENTATION',
        runnerEligibility: 'A1_SYNTHETIC',
      },
      ...overrides,
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

  it('claims distinct rows concurrently through PostgreSQL row locks and SKIP LOCKED', async () => {
    const firstTask = await taskStore.create(task());
    const secondTask = await taskStore.create(task());
    const first = await executionStore.create(claimableExecution(firstTask.id));
    const second = await executionStore.create(claimableExecution(secondTask.id));
    const now = new Date('2026-09-08T00:00:00.000Z');

    const results = await Promise.all([
      runnerClaims.claimNext(
        'engineering-runner:11111111-1111-4111-8111-111111111111',
        now,
      ),
      runnerClaims.claimNext(
        'engineering-runner:22222222-2222-4222-8222-222222222222',
        now,
      ),
    ]);

    expect(results.every((result) => result.claimed)).toBe(true);
    expect(
      new Set(
        results.map((result) =>
          result.claimed ? result.execution.id : null,
        ),
      ),
    ).toEqual(new Set([first.id, second.id]));
  });

  it('reclaims expired DISPATCHED claims and fences expired RUNNING claims', async () => {
    const now = new Date('2026-09-08T00:00:00.000Z');
    const reclaimTask = await taskStore.create(task());
    const reclaimable = await executionStore.create(
      claimableExecution(reclaimTask.id, {
        claimedBy: 'engineering-runner:33333333-3333-4333-8333-333333333333',
        claimEpoch: 4,
        claimedAt: new Date(now.getTime() - 180_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
        lastHeartbeatAt: new Date(now.getTime() - 180_000),
      }),
    );
    const reclaimed = await runnerClaims.claimNext(
      'engineering-runner:44444444-4444-4444-8444-444444444444',
      now,
    );
    expect(reclaimed).toMatchObject({
      claimed: true,
      execution: {
        id: reclaimable.id,
        claimedBy: 'engineering-runner:44444444-4444-4444-8444-444444444444',
        claimEpoch: 5,
      },
    });

    const runningTask = await taskStore.create(task());
    await executionStore.create(
      claimableExecution(runningTask.id, {
        status: 'RUNNING',
        claimedBy: 'engineering-runner:55555555-5555-4555-8555-555555555555',
        claimEpoch: 7,
        claimedAt: new Date(now.getTime() - 180_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
        lastHeartbeatAt: new Date(now.getTime() - 180_000),
      }),
    );
    await expect(
      runnerClaims.claimNext(
        'engineering-runner:66666666-6666-4666-8666-666666666666',
        now,
      ),
    ).resolves.toEqual({ claimed: false });
  });

  it('enforces the partial unique active-runner index under concurrent claims', async () => {
    const firstTask = await taskStore.create(task());
    const secondTask = await taskStore.create(task());
    await executionStore.create(claimableExecution(firstTask.id));
    await executionStore.create(claimableExecution(secondTask.id));
    const now = new Date('2026-09-08T00:00:00.000Z');

    const results = await Promise.allSettled([
      runnerClaims.claimNext(
        'engineering-runner:77777777-7777-4777-8777-777777777777',
        now,
      ),
      runnerClaims.claimNext(
        'engineering-runner:77777777-7777-4777-8777-777777777777',
        now,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('fences persisted v2 worker transitions by claim epoch and live lease', async () => {
    const persistedTask = await taskStore.create(task());
    const queued = await executionStore.create(claimableExecution(persistedTask.id));
    const now = new Date('2026-09-08T00:00:00.000Z');
    const claimed = await runnerClaims.claimNext(
      'engineering-runner:88888888-8888-4888-8888-888888888888',
      now,
    );
    expect(claimed.claimed).toBe(true);
    if (!claimed.claimed) throw new Error('expected claim');

    await expect(
      executionStore.saveIfClaimCurrent(
        { ...claimed.execution, status: 'RUNNING', startedAt: now },
        'DISPATCHED',
        {
          claimedBy: claimed.execution.claimedBy!,
          claimEpoch: claimed.execution.claimEpoch,
          now,
        },
      ),
    ).resolves.toMatchObject({ id: queued.id, status: 'RUNNING' });
    await expect(
      executionStore.saveIfClaimCurrent(
        { ...claimed.execution, status: 'COMPLETED' },
        'RUNNING',
        {
          claimedBy: claimed.execution.claimedBy!,
          claimEpoch: claimed.execution.claimEpoch - 1,
          now,
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'execution_claim_conflict' } });
  });

  it('does not let a stale worker mutation overwrite a concurrent heartbeat lease or capability', async () => {
    const persistedTask = await taskStore.create(task());
    await executionStore.create(claimableExecution(persistedTask.id));
    const claimedAt = new Date('2026-09-08T00:00:00.000Z');
    const claimed = await runnerClaims.claimNext(
      'engineering-runner:99999999-9999-4999-8999-999999999999',
      claimedAt,
    );
    expect(claimed.claimed).toBe(true);
    if (!claimed.claimed) throw new Error('expected claim');

    const heartbeatAt = new Date(claimedAt.getTime() + 30_000);
    const staleMutation = {
      ...claimed.execution,
      status: 'RUNNING' as const,
      startedAt: heartbeatAt,
    };
    const [heartbeat] = await Promise.all([
      runnerClaims.heartbeat(
        claimed.execution.id,
        claimed.execution.claimedBy!,
        claimed.execution.claimEpoch,
        heartbeatAt,
      ),
      executionStore.saveIfClaimCurrent(staleMutation, 'DISPATCHED', {
        claimedBy: claimed.execution.claimedBy!,
        claimEpoch: claimed.execution.claimEpoch,
        now: heartbeatAt,
      }),
    ]);

    const final = await executionStore.get(claimed.execution.id);
    expect(final?.assignment.workerCapability).toEqual(
      heartbeat.assignment.workerCapability,
    );
    expect(final?.leaseExpiresAt?.toISOString()).toBe(heartbeat.leaseExpiresAt);
  });
});
