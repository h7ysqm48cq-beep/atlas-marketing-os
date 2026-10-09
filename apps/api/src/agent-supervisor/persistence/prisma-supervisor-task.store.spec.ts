import type { SupervisorTask } from '../agent-supervisor.types';
import { PrismaSupervisorTaskStore } from './prisma-supervisor-task.store';

function task(overrides: Partial<SupervisorTask> = {}): SupervisorTask {
  return {
    id: 'ATLAS-1',
    objective: 'Persist supervisor task',
    owner: 'backend',
    status: 'WORKING',
    allowedPaths: ['apps/api/src/agent-supervisor/**'],
    forbiddenActions: ['merge'],
    dependsOn: [],
    acceptance: ['task persists'],
    evidence: null,
    blockingReason: null,
    failureReason: null,
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-08-30T00:00:01.000Z'),
    ...overrides,
  };
}

function record(value: SupervisorTask = task()) {
  return {
    ...value,
    allowedPaths: [...value.allowedPaths],
    forbiddenActions: [...value.forbiddenActions],
    dependsOn: [...value.dependsOn],
    acceptance: [...value.acceptance],
    evidence: value.evidence,
  };
}

function mockPrisma() {
  return {
    supervisorTask: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

describe('PrismaSupervisorTaskStore', () => {
  it('creates a task with all persisted domain fields', async () => {
    const prisma = mockPrisma();
    const input = task();
    prisma.supervisorTask.create.mockResolvedValue(record(input));
    const store = new PrismaSupervisorTaskStore(prisma as never);

    await expect(store.create(input)).resolves.toEqual(input);
    expect(prisma.supervisorTask.create).toHaveBeenCalledWith({
      data: {
        id: input.id,
        objective: input.objective,
        owner: input.owner,
        status: input.status,
        allowedPaths: input.allowedPaths,
        forbiddenActions: input.forbiddenActions,
        dependsOn: input.dependsOn,
        acceptance: input.acceptance,
        evidence: null,
        blockingReason: null,
        failureReason: null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      },
    });
  });

  it('returns null when the task does not exist', async () => {
    const prisma = mockPrisma();
    prisma.supervisorTask.findUnique.mockResolvedValue(null);
    const store = new PrismaSupervisorTaskStore(prisma as never);

    await expect(store.get('missing')).resolves.toBeNull();
    expect(prisma.supervisorTask.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
    });
  });

  it('lists tasks oldest first', async () => {
    const prisma = mockPrisma();
    prisma.supervisorTask.findMany.mockResolvedValue([record()]);
    const store = new PrismaSupervisorTaskStore(prisma as never);

    await expect(store.list()).resolves.toHaveLength(1);
    expect(prisma.supervisorTask.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
    });
  });

  it('saves mutable task fields through version-checked persistence', async () => {
    const prisma = mockPrisma();

    const expectedUpdatedAt =
      new Date(
        '2026-08-30T00:00:01.000Z',
      );

    const input = task({
      status: 'IMPLEMENTED',
      blockingReason: 'cleared',
      updatedAt: new Date(
        expectedUpdatedAt.getTime() + 1,
      ),
    });

    prisma.supervisorTask.updateMany
      .mockResolvedValue({ count: 1 });

    prisma.supervisorTask.findUnique
      .mockResolvedValue(record(input));

    const store =
      new PrismaSupervisorTaskStore(
        prisma as never,
      );

    await expect(
      store.saveIfUnchanged(
        input,
        expectedUpdatedAt,
      ),
    ).resolves.toEqual(input);

    expect(
      prisma.supervisorTask.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: input.id,
        updatedAt: expectedUpdatedAt,
      },
      data: {
        objective: input.objective,
        owner: input.owner,
        status: input.status,
        allowedPaths: input.allowedPaths,
        forbiddenActions:
          input.forbiddenActions,
        dependsOn: input.dependsOn,
        acceptance: input.acceptance,
        evidence: null,
        blockingReason:
          input.blockingReason,
        failureReason:
          input.failureReason,
        updatedAt: input.updatedAt,
      },
    });

    expect(
      prisma.supervisorTask.findUnique,
    ).toHaveBeenCalledWith({
      where: { id: input.id },
    });
  });

  // ASTRA_V2_DEPLOYMENT_REVOCATION_STORE_RED
  it('preserves deployment revocation history across get then CAS save', async () => {
    const prisma = mockPrisma();

    const revocation = {
      candidate: {
        action: 'deploy_production' as const,
        targetBranch: 'production/atlas',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changedFiles: [
          'apps/api/src/agent-supervisor/persistence/supervisor-persistence.mapper.ts',
        ],
      },
      service: 'api' as const,
      authorizedBy: 'owner-user-1',
      authorizedAt: '2026-09-05T14:55:00.000Z',
      revokedBy: 'owner-user-2',
      revokedAt: '2026-09-05T15:31:00.000Z',
      reason:
        'Astra Governance v2 bootstrap deployment completed and authorization no longer required',
    };

    const persisted = task({
      status: 'APPROVED',
      evidence: {
        rootCause: 'deployment authorization closure',
        changedFiles: [],
        tests: [],
        build: 'PASS',
        regression: [],
        deploymentState: 'DEPLOYED',
        gitState: 'MERGED',
        remainingRisk: [],
        ownerDeploymentAuthorizationRevocations: [
          revocation,
        ],
      },
    });

    prisma.supervisorTask.findUnique
      .mockResolvedValueOnce(record(persisted));

    const store =
      new PrismaSupervisorTaskStore(prisma as never);

    const loaded = await store.get(persisted.id);

    expect(
      loaded?.evidence
        ?.ownerDeploymentAuthorizationRevocations,
    ).toEqual([revocation]);

    if (!loaded) {
      throw new Error('expected persisted task');
    }

    const expectedUpdatedAt = loaded.updatedAt;

    const next = {
      ...loaded,
      updatedAt: new Date(
        expectedUpdatedAt.getTime() + 1,
      ),
    };

    prisma.supervisorTask.updateMany
      .mockResolvedValue({ count: 1 });

    prisma.supervisorTask.findUnique
      .mockResolvedValueOnce(record(next));

    await store.saveIfUnchanged(
      next,
      expectedUpdatedAt,
    );

    expect(
      prisma.supervisorTask.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidence: expect.objectContaining({
            ownerDeploymentAuthorizationRevocations: [
              revocation,
            ],
          }),
        }),
      }),
    );
  });

  it('preserves a reserved production dispatch across new Prisma store instances and rejects stale CAS writers', async () => {
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
      reservedAt: '2026-10-07T05:28:00.000Z',
    };
    const initial = task({
      status: 'APPROVED',
      evidence: {
        rootCause: 'independent qualification',
        changedFiles: [],
        tests: ['verified'],
        build: 'NOT_RUN',
        regression: [],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'CLEAN',
        remainingRisk: [],
        reviewCandidate: candidate,
      },
    });
    let saved = structuredClone(record(initial));
    const prisma = mockPrisma();
    prisma.supervisorTask.findUnique.mockImplementation(() =>
      Promise.resolve(structuredClone(saved)),
    );
    prisma.supervisorTask.updateMany.mockImplementation(
      (args: {
        where: { id: string; updatedAt: Date };
        data: Partial<SupervisorTask>;
      }) => {
        if (
          args.where.id !== saved.id ||
          args.where.updatedAt.getTime() !== saved.updatedAt.getTime()
        ) {
          return Promise.resolve({ count: 0 });
        }
        saved = structuredClone({ ...saved, ...args.data });
        return Promise.resolve({ count: 1 });
      },
    );

    const firstProcess = new PrismaSupervisorTaskStore(prisma as never);
    const staleSnapshot = await firstProcess.get(initial.id);
    expect(staleSnapshot).not.toBeNull();
    if (!staleSnapshot?.evidence)
      throw new Error('expected persisted evidence');

    const reservedTask: SupervisorTask = {
      ...staleSnapshot,
      updatedAt: new Date(staleSnapshot.updatedAt.getTime() + 1),
      evidence: {
        ...staleSnapshot.evidence,
        ownerDeploymentDispatchReservation: reservation,
      },
    };
    await expect(
      firstProcess.saveIfUnchanged(reservedTask, staleSnapshot.updatedAt),
    ).resolves.toMatchObject({
      evidence: { ownerDeploymentDispatchReservation: reservation },
    });

    // Reconstruct the store and rehydrate the persisted JSON record.
    const restartedProcess = new PrismaSupervisorTaskStore(prisma as never);
    const reloaded = await restartedProcess.get(initial.id);
    expect(reloaded?.evidence?.ownerDeploymentDispatchReservation).toEqual(
      reservation,
    );
    expect(
      reloaded?.evidence?.ownerDeploymentAuthorizationConsumption,
    ).toBeUndefined();

    // An earlier process cannot overwrite the reservation with a stale copy.
    await expect(
      firstProcess.saveIfUnchanged(
        {
          ...staleSnapshot,
          updatedAt: new Date(staleSnapshot.updatedAt.getTime() + 2),
        },
        staleSnapshot.updatedAt,
      ),
    ).resolves.toBeNull();
    const intact = await restartedProcess.get(initial.id);
    expect(intact?.evidence?.ownerDeploymentDispatchReservation).toEqual(
      reservation,
    );
    expect(prisma.supervisorTask.updateMany).toHaveBeenCalledTimes(2);
  });

  it('returns cloned arrays instead of retaining persistence record references', async () => {
    const prisma = mockPrisma();
    const persisted = record();
    prisma.supervisorTask.findUnique.mockResolvedValue(persisted);
    const store = new PrismaSupervisorTaskStore(prisma as never);

    const mapped = await store.get(persisted.id);
    mapped?.allowedPaths.push('mutated');

    expect(persisted.allowedPaths).toEqual(['apps/api/src/agent-supervisor/**']);
  });

  it('recovers a task when only its persisted evidence is malformed', async () => {
    const prisma = mockPrisma();
    const persisted = {
      ...record(
        task({
          status: 'WORKING',
          dependsOn: ['ATLAS-previous'],
          acceptance: ['task remains readable'],
        }),
      ),
      evidence: {
        rootCause: 'malformed persisted evidence',
        changedFiles: [],
        tests: [{ command: 'test', result: 'passed' }],
        build: 'passed',
        regression: [],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'ISOLATED',
        remainingRisk: [],
      },
    };
    prisma.supervisorTask.findUnique.mockResolvedValue(persisted);
    const store = new PrismaSupervisorTaskStore(prisma as never);

    await expect(store.get(persisted.id)).resolves.toMatchObject({
      id: persisted.id,
      status: persisted.status,
      allowedPaths: persisted.allowedPaths,
      dependsOn: persisted.dependsOn,
      acceptance: persisted.acceptance,
      evidence: null,
    });
  });

  it('wraps unknown database failures as supervisor_persistence_error', async () => {
    const prisma = mockPrisma();
    prisma.supervisorTask.findMany.mockRejectedValue(new Error('database down'));
    const store = new PrismaSupervisorTaskStore(prisma as never);

    await expect(store.list()).rejects.toMatchObject({
      response: { code: 'supervisor_persistence_error' },
    });
  });

  // ASTRA_V2_PRISMA_CAS_RED
  it('uses updatedAt compare-and-set so stale task writers cannot overwrite a winner', async () => {
    const prisma = mockPrisma();
    const current = task();
    const next = task({
      objective: 'CAS winner',
      updatedAt: new Date(current.updatedAt.getTime() + 1),
    });

    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.supervisorTask as unknown as {
      updateMany: typeof updateMany;
    }).updateMany = updateMany;
    prisma.supervisorTask.findUnique.mockResolvedValue(record(next));

    const store = new PrismaSupervisorTaskStore(prisma as never);
    const contract = store as unknown as {
      saveIfUnchanged?: (
        value: SupervisorTask,
        expectedUpdatedAt: Date,
      ) => Promise<SupervisorTask | null>;
    };

    expect(contract.saveIfUnchanged).toEqual(expect.any(Function));
    if (!contract.saveIfUnchanged) return;

    await expect(
      contract.saveIfUnchanged(next, current.updatedAt),
    ).resolves.toEqual(next);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: next.id,
          updatedAt: current.updatedAt,
        },
        data: expect.objectContaining({
          objective: 'CAS winner',
        }),
      }),
    );
  });

  it('returns null when the task compare-and-set loses the race', async () => {
    const prisma = mockPrisma();
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    (prisma.supervisorTask as unknown as {
      updateMany: typeof updateMany;
    }).updateMany = updateMany;

    const store = new PrismaSupervisorTaskStore(prisma as never);
    const contract = store as unknown as {
      saveIfUnchanged?: (
        value: SupervisorTask,
        expectedUpdatedAt: Date,
      ) => Promise<SupervisorTask | null>;
    };

    expect(contract.saveIfUnchanged).toEqual(expect.any(Function));
    if (!contract.saveIfUnchanged) return;

    const current = task();

    await expect(
      contract.saveIfUnchanged(
        {
          ...current,
          updatedAt: new Date(current.updatedAt.getTime() + 1),
        },
        current.updatedAt,
      ),
    ).resolves.toBeNull();
  });


  // ASTRA_V2_STORE_CLOSURE_PRISMA_TASK_RED
  it('does not expose legacy unconditional save on PrismaSupervisorTaskStore', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        PrismaSupervisorTaskStore.prototype,
        'save',
      ),
    ).toBe(false);
  });

});
