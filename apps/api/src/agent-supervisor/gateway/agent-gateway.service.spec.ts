import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'integration-owner-token';
const CANONICAL_GITHUB = {
  repositoryOwner: 'h7ysqm48cq-beep',
  repositoryName: 'atlas-marketing-os',
  branch: 'production/atlas',
  commitSha: HEAD_SHA,
};

describe('AgentGatewayService', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let taskStore: MemorySupervisorTaskStore;
  let executionStore: MemorySupervisorExecutionStore;
  let gateway: AgentGatewayService;

  beforeEach(() => {
    taskStore = new MemorySupervisorTaskStore();
    const fileStore = new MemoryFileOwnershipStore();
    executionStore = new MemorySupervisorExecutionStore();
    const config = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
      ),
    } as unknown as ConfigService;
    supervisor = new AgentSupervisorService(
      taskStore,
      fileStore,
      undefined,
      config,
    );
    dispatcher = new WorkerDispatcherService(supervisor, executionStore);
    gateway = new AgentGatewayService(supervisor, executionStore);
  });

  async function createRunningExecution() {
    const task = await supervisor.createTask({
      objective: 'Implement supervised backend change',
      owner: 'backend',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['focused tests pass'],
    });
    await supervisor.startTask(task.id);
    const dispatched = await dispatcher.dispatch(task.id);
    const execution = await dispatcher.markRunning(dispatched.execution.id);
    return { task, execution };
  }

  async function createReadyExecution(
    targetBranch = 'production/atlas',
    authorizeMerge = targetBranch === 'production/atlas',
  ) {
    const { task, execution } = await createRunningExecution();
    const reviewCandidate = {
      action: 'merge' as const,
      targetBranch,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const completed = await dispatcher.complete(execution.id, {
      summary: 'Implemented under Supervisor execution',
      evidence: {
        rootCause: 'Confirmed gateway test cause',
        changedFiles: [CHANGED_FILE],
        tests: ['focused gateway PASS'],
        build: 'PASS',
        regression: ['supervisor PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
        reviewCandidate,
      },
    });
    await gateway.submitImplementationFromExecution(task.id, completed.id);
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);
    if (authorizeMerge) {
      await supervisor.authorizeMerge(task.id, reviewCandidate, 'owner-user-1');
    }
    return { task: await supervisor.getTask(task.id), execution: completed };
  }

  async function createReadyDeploymentExecution(
    action: 'deploy_production' | 'merge' = 'deploy_production',
  ) {
    const { task, execution } = await createRunningExecution();
    const reviewCandidate = {
      action,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const completed = await dispatcher.complete(execution.id, {
      summary: 'Prepared exact production deployment candidate',
      evidence: {
        rootCause: 'Production provenance was not enforced',
        changedFiles: [CHANGED_FILE],
        tests: ['production deployment gate PASS'],
        build: 'PASS',
        regression: ['supervisor PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
        reviewCandidate,
      },
    });
    await gateway.submitImplementationFromExecution(task.id, completed.id);
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);
    return {
      task: await supervisor.getTask(task.id),
      execution: completed,
      reviewCandidate,
    };
  }

  async function authorizeProductionDeployment(
    taskId: string,
    reviewCandidate: {
      action: 'deploy_production' | 'merge';
      targetBranch: string;
      baseSha: string;
      headSha: string;
      changedFiles: string[];
    },
  ) {
    const contract = supervisor as unknown as {
      authorizeProductionDeployment?: (
        id: string,
        candidate: typeof reviewCandidate,
        service: 'api' | 'web' | 'browser-worker',
        authorizedBy: string,
      ) => Promise<unknown>;
    };
    expect(contract.authorizeProductionDeployment).toEqual(
      expect.any(Function),
    );
    if (!contract.authorizeProductionDeployment) return undefined;
    return contract.authorizeProductionDeployment(
      taskId,
      reviewCandidate,
      'api',
      'owner-user-1',
    );
  }

  function productionGateway() {
    return gateway as unknown as {
      checkProductionDeployment(input: unknown): Promise<unknown>;
    };
  }

  it('exposes the production deployment gate contract', () => {
    expect(
      typeof (gateway as unknown as { checkProductionDeployment?: unknown })
        .checkProductionDeployment,
    ).toBe('function');
  });

  it('allows production provenance only against the persisted deployment candidate SHA', async () => {
    const { task, execution, reviewCandidate } =
      await createReadyDeploymentExecution();
    await authorizeProductionDeployment(task.id, reviewCandidate);
    await supervisor.approveTask(task.id, true);

    await expect(
      productionGateway().checkProductionDeployment({
        taskId: task.id,
        executionId: execution.id,
        service: 'api',
        github: CANONICAL_GITHUB,
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it('rejects canonical production provenance without persisted owner deployment authorization', async () => {
    const { task, execution } = await createReadyDeploymentExecution();
    await supervisor.approveTask(task.id, true);

    await expect(
      productionGateway().checkProductionDeployment({
        taskId: task.id,
        executionId: execution.id,
        service: 'api',
        github: CANONICAL_GITHUB,
        approvedSha: HEAD_SHA,
        explicitUserAuthorization: true,
        authorizedBy: 'caller-controlled-owner',
        signature: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_deployment_authorization_required' },
    });
  });

  it('does not reuse valid owner merge authorization as deployment authorization', async () => {
    const { task, execution } = await createReadyDeploymentExecution();
    await supervisor.approveTask(task.id, true);
    const { task: mergeTask } = await createReadyExecution();
    const persistedDeploymentTask = await supervisor.getTask(task.id);
    persistedDeploymentTask.evidence = {
      ...persistedDeploymentTask.evidence!,
      ownerMergeAuthorization: mergeTask.evidence!.ownerMergeAuthorization,
    };
    const expectedUpdatedAt =
      new Date(
        persistedDeploymentTask.updatedAt,
      );

    persistedDeploymentTask.updatedAt =
      new Date(
        expectedUpdatedAt.getTime() + 1,
      );

    await expect(
      taskStore.saveIfUnchanged(
        persistedDeploymentTask,
        expectedUpdatedAt,
      ),
    ).resolves.not.toBeNull();

    await expect(
      productionGateway().checkProductionDeployment({
        taskId: task.id,
        executionId: execution.id,
        service: 'api',
        github: CANONICAL_GITHUB,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_deployment_authorization_required' },
    });
  });

  it('rejects deployment authorization while the task is only READY_FOR_REVIEW', async () => {
    const { task, execution, reviewCandidate } =
      await createReadyDeploymentExecution();
    await authorizeProductionDeployment(task.id, reviewCandidate);

    await expect(
      productionGateway().checkProductionDeployment({
        taskId: task.id,
        executionId: execution.id,
        service: 'api',
        github: CANONICAL_GITHUB,
      }),
    ).rejects.toMatchObject({
      response: { code: 'task_not_deployment_approved' },
    });
  });

  it.each(['DISPATCHED', 'RUNNING', 'FAILED', 'CANCELLED'] as const)(
    'rejects production deployment from a %s execution',
    async (status) => {
      const { task, execution, reviewCandidate } =
        await createReadyDeploymentExecution();
      await authorizeProductionDeployment(task.id, reviewCandidate);
      await supervisor.approveTask(task.id, true);
      await executionStore.save({ ...execution, status });

      await expect(
        productionGateway().checkProductionDeployment({
          taskId: task.id,
          executionId: execution.id,
          service: 'api',
          github: CANONICAL_GITHUB,
        }),
      ).rejects.toMatchObject({
        response: { code: 'execution_not_completed' },
      });
    },
  );

  it('does not reuse a persisted merge candidate as deployment authorization', async () => {
    const { task, execution } = await createReadyDeploymentExecution('merge');

    await expect(
      productionGateway().checkProductionDeployment({
        taskId: task.id,
        executionId: execution.id,
        service: 'api',
        github: CANONICAL_GITHUB,
      }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_candidate_required' },
    });
  });

  it('rejects provenance whose SHA differs from persisted deployment evidence', async () => {
    const { task, execution } = await createReadyDeploymentExecution();

    await expect(
      productionGateway().checkProductionDeployment({
        taskId: task.id,
        executionId: execution.id,
        service: 'browser-worker',
        github: { ...CANONICAL_GITHUB, commitSha: 'c'.repeat(40) },
      }),
    ).rejects.toMatchObject({
      response: { code: 'supervisor_approved_sha_mismatch' },
    });
  });

  it('accepts a running execution whose changed files are inside persisted assignment scope', async () => {
    const { task, execution } = await createRunningExecution();

    await expect(
      gateway.validateWorkerContext({
        taskId: task.id,
        executionId: execution.id,
        externalWorker: 'codex',
        changedFiles: [CHANGED_FILE],
        requestedAction: 'edit_assigned_files',
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it.each(['../secret', '/absolute/path', ''])(
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
        changedFiles: [CHANGED_FILE],
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
    expect(implemented.evidence?.changedFiles).toEqual([CHANGED_FILE]);
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
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'task_not_integration_ready' },
    });
  });

  it('rejects integration when review is ready but persisted owner merge authorization is missing', async () => {
    const { task, execution } = await createReadyExecution(
      'production/atlas',
      false,
    );

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_required' },
    });
  });

  it('still requires explicit integration authorization after signed owner merge authorization exists', async () => {
    const { task, execution } = await createReadyExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
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
        baseSha: BASE_SHA,
        headSha: 'short',
        changedFiles: [CHANGED_FILE],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'invalid_head_sha' },
    });
  });

  it('requires production/atlas for canonical merge decisions', async () => {
    const { task, execution } = await createReadyExecution('main', false);

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'main',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'canonical_target_required' },
    });
  });

  it('allows the exact reviewed canonical merge state after both owner gates and explicit integration authorization', async () => {
    const { task, execution } = await createReadyExecution();

    await expect(
      gateway.checkIntegration({
        taskId: task.id,
        executionId: execution.id,
        action: 'merge',
        targetBranch: 'production/atlas',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        changedFiles: [CHANGED_FILE],
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
