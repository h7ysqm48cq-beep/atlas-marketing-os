import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'resolver-owner-token';

// R2A_FINAL_DEPLOYMENT_OWNER_ARTIFACT_HELPER_BEGIN

type R2ADeploymentCandidate =
  Parameters<
    AgentSupervisorService[
      'authorizeProductionDeployment'
    ]
  >[1];

type R2ADeploymentService =
  Parameters<
    AgentSupervisorService[
      'authorizeProductionDeployment'
    ]
  >[2];

function r2aDeploymentOwnerApprovals(
  service: AgentSupervisorService,
  ownerId = 'owner-user-1',
): HumanOwnerApprovalService {
  const authority =
    (
      service as unknown as {
        authority?: {
          keyRegistry?: unknown;
        };
      }
    ).authority;

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

function r2aDeploymentAuthorization(
  supervisorService: AgentSupervisorService,
  candidate: R2ADeploymentCandidate,
  deploymentService: R2ADeploymentService,
  ownerId = 'owner-user-1',
) {
  const approvals =
    r2aDeploymentOwnerApprovals(
      supervisorService,
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

// R2A_FINAL_DEPLOYMENT_OWNER_ARTIFACT_HELPER_END

const CANONICAL_GITHUB = {
  repositoryOwner: 'h7ysqm48cq-beep',
  repositoryName: 'atlas-marketing-os',
  branch: 'production/atlas',
  commitSha: HEAD_SHA,
};

describe('Production deployment resolver', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let executionStore: MemorySupervisorExecutionStore;
  let gateway: AgentGatewayService;

  beforeEach(() => {
    const taskStore = new MemorySupervisorTaskStore();
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

  async function createApprovedDeployment(
    service: 'api' | 'web' | 'browser-worker' = 'api',
    options: { runtimeRefresh?: boolean } = {},
  ) {
    const task = await supervisor.createTask({
      objective: `Authorize exact ${service} production deployment`,
      owner: 'infra',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['production deployment resolver passes'],
    });
    await supervisor.startTask(task.id);
    const queued = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(queued.execution.id);
    const running = await dispatcher.markRunning(queued.execution.id);
    const reviewCandidate = options.runtimeRefresh
      ? {
          action: 'deploy_production' as const,
          targetBranch: 'production/atlas',
          baseSha: HEAD_SHA,
          headSha: HEAD_SHA,
          changedFiles: [],
        }
      : {
          action: 'deploy_production' as const,
          targetBranch: 'production/atlas',
          baseSha: BASE_SHA,
          headSha: HEAD_SHA,
          changedFiles: [CHANGED_FILE],
        };
    const completed = await dispatcher.complete(running.id, {
      summary: 'Prepared exact deployment receipt',
      evidence: {
        rootCause: 'Railway requires automatic Supervisor receipt resolution',
        changedFiles: [...reviewCandidate.changedFiles],
        tests: ['resolver contract'],
        build: 'PASS',
        regression: [],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
        reviewCandidate,
      },
    });
    await gateway.submitImplementationFromExecution(task.id, completed.id);
    await supervisor.beginVerification(task.id);
    await supervisor.markReadyForReview(task.id);

    const authorize = (
      supervisor as unknown as {
        authorizeProductionDeployment?: (...args: unknown[]) => Promise<unknown>;
      }
    ).authorizeProductionDeployment;
    expect(authorize).toEqual(expect.any(Function));
    await authorize!.call(
      supervisor,
      task.id,
      reviewCandidate,
      service,
      r2aDeploymentAuthorization(supervisor, reviewCandidate, service, 'owner-user-1'),
    );
    await supervisor.approveTask(task.id, true);
    return { task: await supervisor.getTask(task.id), execution: completed };
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

  function resolve(input: unknown) {
    const contract = gateway as unknown as {
      resolveProductionDeployment?: (value: unknown) => Promise<unknown>;
    };
    expect(contract.resolveProductionDeployment).toEqual(expect.any(Function));
    return contract.resolveProductionDeployment!(input);
  }

  it('resolves the unique approved service-bound receipt from canonical provenance', async () => {
    const { task, execution } = await createApprovedDeployment('api');

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it('resolves an exact same-SHA zero-diff runtime refresh receipt', async () => {
    const { task, execution } = await createApprovedDeployment('api', {
      runtimeRefresh: true,
    });

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it('consumes the deployment approval before returning a consequential resolution', async () => {
    const { task, execution } = await createApprovedDeployment('api');

    await resolve({ service: 'api', github: CANONICAL_GITHUB });

    await expect(resolve({ service: 'api', github: CANONICAL_GITHUB })).rejects.toMatchObject({
      response: { code: 'owner_deployment_authorization_already_consumed' },
    });
    expect((await supervisor.getTask(task.id)).evidence?.ownerDeploymentAuthorizationConsumption).toMatchObject({
      consumedBy: 'deploy-gate',
    });
    expect(execution.id).toBeDefined();
  });

  it('prefers the unique unconsumed authorization when an older same-SHA authorization is already consumed', async () => {
    const consumed = await createApprovedDeployment('api');
    await resolve({ service: 'api', github: CANONICAL_GITHUB });

    const fresh = await createApprovedDeployment('api', {
      runtimeRefresh: true,
    });

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: fresh.task.id,
      executionId: fresh.execution.id,
    });

    expect(
      (await supervisor.getTask(consumed.task.id)).evidence
        ?.ownerDeploymentAuthorizationConsumption,
    ).toBeDefined();
  });

  it('rejects when no approved deployment receipt matches the provenance', async () => {
    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_resolution_not_found' },
    });
  });

  it('rejects ambiguous matching deployment tasks instead of choosing one', async () => {
    await createApprovedDeployment('api');
    await createApprovedDeployment('api');

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_resolution_ambiguous' },
    });
  });

  it('does not reuse an api deployment authorization for web', async () => {
    await createApprovedDeployment('api');

    await expect(
      resolve({ service: 'web', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'owner_deployment_authorization_service_mismatch' },
    });
  });

  it('rejects duplicate matching completed executions instead of picking one', async () => {
    const { execution } = await createApprovedDeployment('api');
    await executionStore.create({
      ...execution,
      id: `${execution.id}-duplicate`,
      createdAt: new Date(execution.createdAt.getTime() + 1),
      completedAt: execution.completedAt
        ? new Date(execution.completedAt.getTime() + 1)
        : new Date(),
    });

    await expect(
      resolve({ service: 'api', github: CANONICAL_GITHUB }),
    ).rejects.toMatchObject({
      response: { code: 'production_deployment_resolution_ambiguous' },
    });
  });

  it('rejects noncanonical provenance before resolving a receipt', async () => {
    await createApprovedDeployment('api');

    await expect(
      resolve({
        service: 'api',
        github: { ...CANONICAL_GITHUB, branch: 'feature/not-production' },
      }),
    ).rejects.toMatchObject({
      response: { code: 'canonical_production_branch_required' },
    });
  });
});
