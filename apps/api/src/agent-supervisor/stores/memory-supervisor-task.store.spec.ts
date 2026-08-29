import type { SupervisorTask } from '../agent-supervisor.types';
import { MemorySupervisorTaskStore } from './memory-supervisor-task.store';

function taskFixture(): SupervisorTask {
  const now = new Date('2026-08-30T00:00:00.000Z');
  return {
    id: 'ATLAS-1',
    objective: 'Original objective',
    owner: 'backend',
    status: 'DRAFT',
    allowedPaths: ['a.ts'],
    forbiddenActions: ['merge'],
    dependsOn: [],
    acceptance: ['works'],
    evidence: null,
    blockingReason: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('MemorySupervisorTaskStore', () => {
  it('saves and returns cloned tasks', () => {
    const store = new MemorySupervisorTaskStore();
    const saved = store.create(taskFixture());

    saved.objective = 'mutated';
    saved.allowedPaths.push('b.ts');

    const stored = store.get(saved.id);
    expect(stored?.objective).toBe('Original objective');
    expect(stored?.allowedPaths).toEqual(['a.ts']);
  });

  it('returns cloned task lists', () => {
    const store = new MemorySupervisorTaskStore();
    store.create(taskFixture());

    const listed = store.list();
    listed[0].objective = 'mutated';

    expect(store.get('ATLAS-1')?.objective).toBe('Original objective');
  });
});
