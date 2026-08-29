import { ConflictException } from '@nestjs/common';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
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
    ...overrides,
  };
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

    expect((persisted.assignment as SupervisorExecution['assignment']).allowedPaths).toEqual([
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
    prisma.supervisorExecution.findMany.mockRejectedValue(new Error('database down'));
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
});