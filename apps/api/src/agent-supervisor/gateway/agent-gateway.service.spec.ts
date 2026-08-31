import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

describe('AgentGatewayService', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let executionStore: MemorySupervisorExecutionStore;
  let gateway: AgentGatewayService;

  beforeEach(() => {
    const taskStore = new MemorySupervisorTaskStore();
    const fileStore = new MemoryFileOwnershipStore();
    executionStore = new MemorySupervisorExecutionStore();
    supervisor = new AgentSupervisorService(taskStore, fileStore);
    dispatcher = new WorkerDispatcherService(supervisor, executionStore);
    gateway = new AgentGatewayService(supervisor, executionStore);
  });

  async function createRunningExecution() {
    const task = await supervisor.createTask({
      objective: 'Implement supervised backend change',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['focused tests pass'],
    });
    await supervisor.startTask(task.id);
    const dispatched = await dispatcher.dispatch(task.id);
    const execution = await dispatcher.markRunning(dispatched.execution.id);
    return { task, execution };
  }

  it('accepts a running execution whose changed files are inside persisted assignment scope', async () => {
    const { task, execution } = await createRunningExecution();

    await expect(
      gateway.validateWorkerContext({
        taskId: task.id,
        executionId: execution.id,
        externalWorker: 'codex',
        changedFiles: ['apps/api/src/example.ts'],
        requestedAction: 'edit_assigned_files',
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it.each(['../secret', '/absolute/path', '']) (
    'rejects invalid repository path %p',
    async (path) => {
      const { task, execution } = await createRunningExecution();

      await expect(
        gateway.validateWorkerContext({
          taskId: task.id,
          executionId: execution.id,
          externalWorker: 'codex',
          changedFiles: [path],
        }),
      ).rejects.toMatchObject({
        response: { code: 'invalid_repo_path' },
      });
    },
  );

  it('rejects a changed file outside persisted assignment scope', async () => {
    const { task, execution } = await createRunningExecution();

    await expect(
      gateway.validateWorkerContext({
        taskId: task.id,
        executionId: execution.id,
        externalWorker: 'chatgpt-work',
        changedFiles: ['apps/api/src/unassigned.ts'],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'changed_file_out_of_scope',
        path: 'apps/api/src/unassigned.ts',
      },
    });
  });

  it('rejects protected worker actions even when execution is valid', async () => {
    const { task, execution } = await createRunningExecution();

    await expect(
      gateway.validateWorkerContext({
        taskId: task.id,
        executionId: execution.id,
        externalWorker: 'external-agent',
        requestedAction: 'merge',
      }),
    ).rejects.toMatchObject({
      response: { code: 'worker_protected_action_denied' },
    });
  });
});
