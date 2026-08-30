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
  it('exposes asynchronous store operations', async () => {
    const store = new MemorySupervisorTaskStore();

    const createResult = store.create(taskFixture());
    expect(createResult).toBeInstanceOf(Promise);
    await createResult;

    expect(store.get('ATLAS-1')).toBeInstanceOf(Promise);
    expect(store.list()).toBeInstanceOf(Promise);
    expect(store.save(taskFixture())).toBeInstanceOf(Promise);
  });

  it('saves and returns cloned tasks', async () => {
    const store = new MemorySupervisorTaskStore();
    const saved = await store.create(taskFixture());

    saved.objective = 'mutated';
    saved.allowedPaths.push('b.ts');

    const stored = await store.get(saved.id);
    expect(stored?.objective).toBe('Original objective');
    expect(stored?.allowedPaths).toEqual(['a.ts']);
  });

  it('returns cloned task lists', async () => {
    const store = new MemorySupervisorTaskStore();
    await store.create(taskFixture());

    const listed = await store.list();
    listed[0].objective = 'mutated';

    expect((await store.get('ATLAS-1'))?.objective).toBe('Original objective');
  });
});
