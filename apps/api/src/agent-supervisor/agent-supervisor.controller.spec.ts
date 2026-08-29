import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorService } from './agent-supervisor.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from './stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';

describe('AgentSupervisorController', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let controller: AgentSupervisorController;

  beforeEach(() => {
    supervisor = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    dispatcher = new WorkerDispatcherService(
      supervisor,
      new MemorySupervisorExecutionStore(),
    );
    controller = new AgentSupervisorController(supervisor, dispatcher);
  });

  it('dispatches a task without accepting role or permission overrides', () => {
    const task = supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['passes'],
    });
    supervisor.startTask(task.id);

    const result = controller.dispatchTask(task.id);

    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.forbiddenActions).toContain('merge');
  });

  it('lists execution history for a task', () => {
    const task = supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });
    supervisor.startTask(task.id);
    dispatcher.dispatch(task.id);

    expect(controller.listExecutions(task.id)).toHaveLength(1);
  });
});
