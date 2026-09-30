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
    const current =
      await store.get('ATLAS-1');

    if (!current) {
      throw new Error(
        'test_setup_task_missing',
      );
    }

    const next = {
      ...current,
      updatedAt: new Date(
        current.updatedAt.getTime() + 1,
      ),
    };

    const saveResult =
      store.saveIfUnchanged(
        next,
        current.updatedAt,
      );

    expect(saveResult).toBeInstanceOf(Promise);
    await saveResult;
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

  // ASTRA_V2_MEMORY_CAS_RED
  it('compare-and-set saves only when updatedAt still matches', async () => {
    const store = new MemorySupervisorTaskStore();
    const current = await store.create(taskFixture());

    const contract = store as unknown as {
      saveIfUnchanged?: (
        task: SupervisorTask,
        expectedUpdatedAt: Date,
      ) => Promise<SupervisorTask | null>;
    };

    expect(contract.saveIfUnchanged).toEqual(expect.any(Function));
    if (!contract.saveIfUnchanged) return;

    const next = {
      ...current,
      objective: 'CAS winner',
      updatedAt: new Date(current.updatedAt.getTime() + 1),
    };

    await expect(
      contract.saveIfUnchanged(next, current.updatedAt),
    ).resolves.toMatchObject({
      objective: 'CAS winner',
    });

    await expect(
      contract.saveIfUnchanged(
        {
          ...next,
          objective: 'stale writer',
          updatedAt: new Date(next.updatedAt.getTime() + 1),
        },
        current.updatedAt,
      ),
    ).resolves.toBeNull();
  });


  // ASTRA_V2_STORE_CLOSURE_MEMORY_RED
  it('does not expose legacy unconditional save on MemorySupervisorTaskStore', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        MemorySupervisorTaskStore.prototype,
        'save',
      ),
    ).toBe(false);
  });

});
