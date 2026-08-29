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
  it('keeps execution history per task in creation order', () => {
    const store = new MemorySupervisorExecutionStore();
    store.create(executionFixture('EXEC-1', 'ATLAS-1'));
    store.create(executionFixture('EXEC-2', 'ATLAS-1'));
    store.create(executionFixture('EXEC-3', 'ATLAS-2'));

    expect(store.listByTask('ATLAS-1').map((x) => x.id)).toEqual([
      'EXEC-1',
      'EXEC-2',
    ]);
  });

  it('returns clones so callers cannot mutate stored execution state', () => {
    const store = new MemorySupervisorExecutionStore();
    const created = store.create(executionFixture('EXEC-1', 'ATLAS-1'));

    created.status = 'FAILED';
    created.assignment.allowedPaths.push('outside.ts');

    const stored = store.get('EXEC-1');
    expect(stored?.status).toBe('QUEUED');
    expect(stored?.assignment.allowedPaths).toEqual([
      'apps/api/src/example.ts',
    ]);
  });
});
