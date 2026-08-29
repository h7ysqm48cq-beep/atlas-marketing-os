import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { WorkerDispatcherService } from './worker-dispatcher.service';

const PROTECTED_ACTIONS = [
  'merge',
  'rebase',
  'squash',
  'cherry_pick',
  'auto_merge',
  'force_push',
  'delete_branch_for_integration',
];

describe('WorkerDispatcherService', () => {
  let supervisor: AgentSupervisorService;
  let fileStore: MemoryFileOwnershipStore;
  let executionStore: MemorySupervisorExecutionStore;
  let dispatcher: WorkerDispatcherService;

  beforeEach(() => {
    const taskStore = new MemorySupervisorTaskStore();
    fileStore = new MemoryFileOwnershipStore();
    executionStore = new MemorySupervisorExecutionStore();
    supervisor = new AgentSupervisorService(taskStore, fileStore);
    dispatcher = new WorkerDispatcherService(supervisor, executionStore);
  });

  async function createWorkingTask() {
    const task = await supervisor.createTask({
      objective: 'Implement backend change',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['focused tests pass'],
    });
    return supervisor.startTask(task.id);
  }

  it('dispatches a WORKING task with owned files', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id);

    expect(result.execution.status).toBe('DISPATCHED');
    expect(result.assignment.taskId).toBe(task.id);
    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.allowedPaths).toEqual(task.allowedPaths);
  });

  it('rejects dispatch when task is not WORKING', async () => {
    const task = await supervisor.createTask({
      objective: 'Draft task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });

    await expect(dispatcher.dispatch(task.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects dispatch when file ownership was lost', async () => {
    const task = await createWorkingTask();
    await fileStore.release(task.id);

    await expect(dispatcher.dispatch(task.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a second active execution for the same task before persistence', async () => {
    const task = await createWorkingTask();
    await dispatcher.dispatch(task.id);

    await expect(dispatcher.dispatch(task.id)).rejects.toMatchObject({
      response: {
        code: 'active_execution_exists',
        taskId: task.id,
      },
    });
  });

  it('always includes protected integration actions in the assignment envelope', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id);

    expect(result.assignment.forbiddenActions).toEqual(
      expect.arrayContaining(PROTECTED_ACTIONS),
    );
  });

  it('creates a new execution for each retry after the previous execution is terminal', async () => {
    const task = await createWorkingTask();

    const first = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(first.execution.id);
    await dispatcher.fail(first.execution.id, 'worker failed');
    const second = await dispatcher.dispatch(task.id);

    expect(second.execution.id).not.toBe(first.execution.id);
    expect(await executionStore.listByTask(task.id)).toHaveLength(2);
  });

  it('rejects malformed worker results with invalid_worker_result', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, {
        summary: 'Implemented',
      } as never),
    ).rejects.toMatchObject({
      response: { code: 'invalid_worker_result' },
    });
  });

  it('does not move the task to READY_FOR_REVIEW when execution completes', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(dispatched.execution.id);
    await dispatcher.complete(dispatched.execution.id, {
      summary: 'Implemented',
      evidence: {
        rootCause: 'Known cause',
        changedFiles: ['apps/api/src/example.ts'],
        tests: ['focused test PASS'],
        build: 'PASS',
        regression: ['adjacent PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
      },
    });

    expect((await supervisor.getTask(task.id)).status).toBe('WORKING');
  });
});
