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
      update: jest.fn(),
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

  it('saves mutable task fields and maps the returned row', async () => {
    const prisma = mockPrisma();
    const input = task({ status: 'IMPLEMENTED', blockingReason: 'cleared' });
    prisma.supervisorTask.update.mockResolvedValue(record(input));
    const store = new PrismaSupervisorTaskStore(prisma as never);

    await expect(store.save(input)).resolves.toEqual(input);
    expect(prisma.supervisorTask.update).toHaveBeenCalledWith({
      where: { id: input.id },
      data: {
        objective: input.objective,
        owner: input.owner,
        status: input.status,
        allowedPaths: input.allowedPaths,
        forbiddenActions: input.forbiddenActions,
        dependsOn: input.dependsOn,
        acceptance: input.acceptance,
        evidence: null,
        blockingReason: input.blockingReason,
        failureReason: input.failureReason,
        updatedAt: input.updatedAt,
      },
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
});
