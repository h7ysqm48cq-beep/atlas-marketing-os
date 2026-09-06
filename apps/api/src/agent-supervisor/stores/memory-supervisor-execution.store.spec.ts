import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { MemorySupervisorExecutionStore } from './memory-supervisor-execution.store';

function executionFixture(id: string, taskId: string): SupervisorExecution {
  const now = new Date('2026-08-30T00:00:00.000Z');
  return {
    id,
    taskId,
    workerRole: 'backend',
    status: 'QUEUED',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'backend',
      objective: 'Implement bounded backend change',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      dependencies: [],
      acceptance: ['passes'],
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
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
}

describe('MemorySupervisorExecutionStore', () => {
  it('exposes asynchronous store operations', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-1', 'ATLAS-1');

    const createResult = store.create(fixture);
    expect(createResult).toBeInstanceOf(Promise);
    await createResult;

    expect(store.get('EXEC-1')).toBeInstanceOf(Promise);
    expect(store.listByTask('ATLAS-1')).toBeInstanceOf(Promise);
    expect(store.save(fixture)).toBeInstanceOf(Promise);
  });

  it('keeps execution history per task in creation order', async () => {
    const store = new MemorySupervisorExecutionStore();
    await store.create(executionFixture('EXEC-1', 'ATLAS-1'));
    await store.create(executionFixture('EXEC-2', 'ATLAS-1'));
    await store.create(executionFixture('EXEC-3', 'ATLAS-2'));

    expect((await store.listByTask('ATLAS-1')).map((x) => x.id)).toEqual([
      'EXEC-1',
      'EXEC-2',
    ]);
  });

  it('returns clones so callers cannot mutate stored execution state', async () => {
    const store = new MemorySupervisorExecutionStore();
    const created = await store.create(executionFixture('EXEC-1', 'ATLAS-1'));

    created.status = 'FAILED';
    created.assignment.allowedPaths.push('outside.ts');

    const stored = await store.get('EXEC-1');
    expect(stored?.status).toBe('QUEUED');
    expect(stored?.assignment.allowedPaths).toEqual([
      'apps/api/src/example.ts',
    ]);
  });

  it('round-trips execution purpose and non-secret capability metadata', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-1', 'ATLAS-1');
    fixture.assignment.executionPurpose = 'INDEPENDENT_VERIFICATION';
    fixture.assignment.workerCapability = {
      version: 1,
      assignmentDigest: 'a'.repeat(64),
      allowedOperations: ['read_assignment', 'mark_running'],
      issuedAt: '2026-09-06T00:00:00.000Z',
      expiresAt: '2026-09-06T00:05:00.000Z',
    };

    await store.create(fixture);

    await expect(store.get(fixture.id)).resolves.toMatchObject({
      assignment: {
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        workerCapability: fixture.assignment.workerCapability,
      },
    });
  });

  it('allows only one concurrent terminal write from RUNNING', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-1', 'ATLAS-1');
    fixture.status = 'RUNNING';
    await store.create(fixture);
    const completed = { ...fixture, status: 'COMPLETED' as const };
    const failed = { ...fixture, status: 'FAILED' as const };

    const results = await Promise.allSettled([
      store.saveIfStatus(completed, 'RUNNING'),
      store.saveIfStatus(failed, 'RUNNING'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const stored = await store.get(fixture.id);
    expect(['COMPLETED', 'FAILED']).toContain(stored?.status);
  });
});
