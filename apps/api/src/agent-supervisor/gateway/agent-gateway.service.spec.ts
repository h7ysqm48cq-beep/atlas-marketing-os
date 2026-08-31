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

  async function createReadyExecution() {
    const { task, execution } = await createRunningExecution();
    const completed = await dispatcher.complete(execution.id, {
      summary: 'Implemented under Supervisor execution',
      evidence: {
        rootCause: 'Confirmed gateway test cause',
        changedFiles: ['apps/api/src/example.ts'],
        tests: ['focused gateway PASS'],
        build: 'PASS',
        regression: ['supervisor PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
      },
    });
    await gateway.submitImplementationFromExecution(task.id, completed.id);
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);
    return { task: await supervisor.getTask(task.id), execution: completed };
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

  it('submits task implementation only from persisted completed execution evidence', async () => {
    const { task, execution } = await createRunningExecution();
    const completed = await dispatcher.complete(execution.id, {
      summary: 'Implemented under Supervisor execution',
      evidence: {
        rootCause: 'Confirmed gateway test cause',
        changedFiles: ['apps/api/src/example.ts'],
        tests: ['focused gateway PASS'],
        build: 'PASS',
        regression: ['supervisor PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
      },
    });

    const implemented = await gateway.submitImplementationFromExecution(
      task.id,
      completed.id,
    );

    expect(implemented.status).toBe('IMPLEMENTED');
    expect(implemented.evidence?.changedFiles).toEqual([
      'apps/api/src/example.ts',
    ]);
  });

  it('rejects implementation submission from a non-completed execution', async () => {
    const { task, execution } = await createRunningExecution();

    await expect(
      gateway.submitImplementationFromExecution(task.id, execution.id),
    ).rejects.toMatchObject({
      response: { code: 'execution_not_completed' },
    });
  });

  it('rejects integration before the task is READY_FOR_REVIEW', async () => {
    const { task, execution } = await createRunningExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changedFiles: ['apps/api/src/example.ts'],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'task_not_integration_ready' },
    });
  });

  it('rejects a canonical merge without explicit owner authorization', async () => {
    const { task, execution } = await createReadyExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changedFiles: ['apps/api/src/example.ts'],
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'explicit_user_authorization_required' },
    });
  });

  it('rejects invalid git SHA values', async () => {
    const { task, execution } = await createReadyExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: 'a'.repeat(40),
        headSha: 'short',
        changedFiles: ['apps/api/src/example.ts'],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'invalid_head_sha' },
    });
  });

  it('requires production/atlas for canonical merge decisions', async () => {
    const { task, execution } = await createReadyExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'main',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changedFiles: ['apps/api/src/example.ts'],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'canonical_target_required' },
    });
  });

  it('allows the exact reviewed canonical merge state after explicit authorization', async () => {
    const { task, execution } = await createReadyExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changedFiles: ['apps/api/src/example.ts'],
        explicitUserAuthorization: true,
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });
});
