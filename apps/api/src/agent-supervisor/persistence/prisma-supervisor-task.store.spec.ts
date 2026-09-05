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

  it('returns cloned arrays instead of retaining persistence record references', async () => {
    const prisma = mockPrisma();
    const persisted = record();
    prisma.supervisorTask.findUnique.mockResolvedValue(persisted);
    const store = new PrismaSupervisorTaskStore(prisma as never);

    const mapped = await store.get(persisted.id);
    mapped?.allowedPaths.push('mutated');

    expect(persisted.allowedPaths).toEqual(['apps/api/src/agent-supervisor/**']);
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
