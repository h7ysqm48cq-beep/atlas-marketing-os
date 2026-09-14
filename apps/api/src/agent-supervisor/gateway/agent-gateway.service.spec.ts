import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';
import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'integration-owner-token';

// R2A_OUT_OF_SCOPE_OWNER_ARTIFACT_HELPER_BEGIN

type R2AReviewCandidate =
  Parameters<
    AgentSupervisorService['authorizeMerge']
  >[1];

type R2ADeploymentService =
  Parameters<
    AgentSupervisorService[
      'authorizeProductionDeployment'
    ]
  >[2];

function r2aOwnerApprovalService(
  service: AgentSupervisorService,
  ownerId = 'owner-user-1',
): HumanOwnerApprovalService {
  const authority =
    (
      service as unknown as {
        authority?: unknown;
      }
    ).authority as
      | {
          keyRegistry?: unknown;
        }
      | undefined;

  const keyRegistry =
    authority?.keyRegistry;

  if (!keyRegistry) {
    throw new Error(
      'r2a_test_owner_keyring_missing',
    );
  }

  const config = {
    get: (key: string) => {
      if (
        key ===
        'ATLAS_SUPERVISOR_OWNER_USER_ID'
      ) {
        return ownerId;
      }

      if (
        key ===
        'ATLAS_SUPERVISOR_OWNER_TOKEN'
      ) {
        return OWNER_TOKEN;
      }

      return undefined;
    },
  } as unknown as ConfigService;

  return new HumanOwnerApprovalService(
    config,
    keyRegistry as never,
  );
}

function r2aMergeAuthorization(
  service: AgentSupervisorService,
  candidate: R2AReviewCandidate,
  ownerId = 'owner-user-1',
) {
  const approvals =
    r2aOwnerApprovalService(
      service,
      ownerId,
    );

  const proof =
    approvals.verifyAuthentication(
      {
        userId: ownerId,
        ownerAction: '1',
        ownerToken: OWNER_TOKEN,
      },
      {
        action: 'MERGE',
        candidate,
      },
    );

  return approvals.issueMergeApproval(
    proof,
    candidate,
  );
}

function r2aAuthorizeMergeAsOwner(
  service: AgentSupervisorService,
  taskId: string,
  candidate: R2AReviewCandidate,
  ownerId = 'owner-user-1',
) {
  return service.authorizeMerge(
    taskId,
    candidate,
    r2aMergeAuthorization(
      service,
      candidate,
      ownerId,
    ),
  );
}

function r2aDeploymentAuthorization(
  service: AgentSupervisorService,
  candidate: R2AReviewCandidate,
  deploymentService: R2ADeploymentService,
  ownerId = 'owner-user-1',
) {
  const approvals =
    r2aOwnerApprovalService(
      service,
      ownerId,
    );

  const proof =
    approvals.verifyAuthentication(
      {
        userId: ownerId,
        ownerAction: '1',
        ownerToken: OWNER_TOKEN,
      },
      {
        action: 'DEPLOY',
        candidate,
        service: deploymentService,
      },
    );

  return approvals.issueDeployApproval(
    proof,
    candidate,
    deploymentService,
  );
}

// R2A_OUT_OF_SCOPE_OWNER_ARTIFACT_HELPER_END

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
      createTestSupervisorAuthority(),
    );
    dispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
      new SupervisorWorkerCapabilityService(createTestSupervisorAuthority()),
      new SupervisorAdmissionManifestService(),
    );
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
    const queued = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(queued.execution.id);
    const execution = await dispatcher.markRunning(queued.execution.id);
    return { task, execution };
  }

  async function moveQueuedToLegacyDispatched(executionId: string) {
    const execution = await executionStore.get(executionId);
    if (!execution) {
      throw new Error('test_execution_missing');
    }
    expect(execution.status).toBe('QUEUED');
    execution.status = 'DISPATCHED';
    return executionStore.saveIfStatus(execution, 'QUEUED');
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
      await r2aAuthorizeMergeAsOwner(supervisor, task.id, reviewCandidate, 'owner-user-1');
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
        authorization: Parameters<
          AgentSupervisorService['authorizeProductionDeployment']
        >[3],
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
      r2aDeploymentAuthorization(supervisor, reviewCandidate, 'api', 'owner-user-1'),
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
    const expectedUpdatedAt = new Date(persistedDeploymentTask.updatedAt);
    persistedDeploymentTask.updatedAt = new Date(expectedUpdatedAt.getTime() + 1);

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

  it('keeps ordinary consumption expired while requiring trusted CI consumption for a merge that occurred inside the original authorization window', async () => {
    jest.useFakeTimers();

    try {
      jest.setSystemTime(new Date('2026-09-14T00:00:00.000Z'));
      const { task, execution } = await createReadyExecution();
      await supervisor.approveTask(task.id, true);

      const approved = await supervisor.getTask(task.id);
      const authorization = approved.evidence?.ownerMergeAuthorization;
      expect(authorization).toBeDefined();
      if (!authorization) return;

      const mergedAt = new Date(
        Date.parse(authorization.authorizedAt) + 60_000,
      ).toISOString();
      const attestation = {
        pullRequestNumber: 104,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: [BASE_SHA, HEAD_SHA] as [string, string],
        mergedAt,
      };

      jest.setSystemTime(
        new Date(Date.parse(authorization.authorizedAt) + 11 * 60_000),
      );

      await expect(
        supervisor.consumeMergeAuthorization(
          task.id,
          attestation,
          'owner-user-1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'owner_merge_authorization_invalid' },
      });

      const trustedGateway = gateway as unknown as {
        consumeTrustedMergeAuthorization?: (input: {
          taskId: string;
          executionId: string;
          action: 'merge';
          targetBranch: string;
          baseSha: string;
          headSha: string;
          changedFiles: string[];
          attestation: typeof attestation;
        }) => Promise<unknown>;
      };

      expect(trustedGateway.consumeTrustedMergeAuthorization).toEqual(
        expect.any(Function),
      );

      if (!trustedGateway.consumeTrustedMergeAuthorization) return;

      await expect(
        trustedGateway.consumeTrustedMergeAuthorization({
          taskId: task.id,
          executionId: execution.id,
          action: 'merge',
          targetBranch: 'production/atlas',
          baseSha: BASE_SHA,
          headSha: HEAD_SHA,
          changedFiles: [CHANGED_FILE],
          attestation,
        }),
      ).resolves.toEqual({
        allowed: true,
        reason: null,
        taskId: task.id,
        executionId: execution.id,
      });
    } finally {
      jest.useRealTimers();
    }
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
