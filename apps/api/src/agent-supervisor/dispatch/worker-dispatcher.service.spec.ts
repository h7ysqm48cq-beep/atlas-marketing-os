import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { WorkerDispatcherService } from './worker-dispatcher.service';

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

  function createWorkingTask() {
    const task = supervisor.createTask({
      objective: 'Implement backend change',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['focused tests pass'],
    });
    return supervisor.startTask(task.id);
  }

  it('dispatches a WORKING task with owned files', () => {
    const task = createWorkingTask();

    const result = dispatcher.dispatch(task.id);

    expect(result.execution.status).toBe('DISPATCHED');
    expect(result.assignment.taskId).toBe(task.id);
    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.allowedPaths).toEqual(task.allowedPaths);
  });

  it('rejects dispatch when task is not WORKING', () => {
    const task = supervisor.createTask({
      objective: 'Draft task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });

    expect(() => dispatcher.dispatch(task.id)).toThrow(BadRequestException);
  });

  it('rejects dispatch when file ownership was lost', () => {
    const task = createWorkingTask();
    fileStore.release(task.id);

    expect(() => dispatcher.dispatch(task.id)).toThrow(ConflictException);
  });

  it('creates a new execution for each retry', () => {
    const task = createWorkingTask();

    const first = dispatcher.dispatch(task.id);
    dispatcher.markRunning(first.execution.id);
    dispatcher.fail(first.execution.id, 'worker failed');
    const second = dispatcher.dispatch(task.id);

    expect(second.execution.id).not.toBe(first.execution.id);
    expect(executionStore.listByTask(task.id)).toHaveLength(2);
  });

  it('does not move the task to READY_FOR_REVIEW when execution completes', () => {
    const task = createWorkingTask();
    const dispatched = dispatcher.dispatch(task.id);
    dispatcher.markRunning(dispatched.execution.id);
    dispatcher.complete(dispatched.execution.id, {
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

    expect(supervisor.getTask(task.id).status).toBe('WORKING');
  });
});
