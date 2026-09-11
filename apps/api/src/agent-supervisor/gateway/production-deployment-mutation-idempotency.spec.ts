import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';
import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'mutation-claim-owner-token';
const CANONICAL_GITHUB = {
  repositoryOwner: 'h7ysqm48cq-beep',
  repositoryName: 'atlas-marketing-os',
  branch: 'production/atlas',
  commitSha: HEAD_SHA,
};

type DeploymentCandidate = Parameters<
  AgentSupervisorService['authorizeProductionDeployment']
>[1];

type DeploymentService = Parameters<
  AgentSupervisorService['authorizeProductionDeployment']
>[2];

function deploymentAuthorization(
  supervisor: AgentSupervisorService,
  candidate: DeploymentCandidate,
  service: DeploymentService,
  ownerId = 'owner-user-1',
) {
  const authority = (
    supervisor as unknown as {
      authority?: {
        keyRegistry?: unknown;
      };
    }
  ).authority;
  const keyRegistry = authority?.keyRegistry;
  if (!keyRegistry) {
    throw new Error('test_owner_keyring_missing');
  }

  const config = {
    get: (key: string) => {
      if (key === 'ATLAS_SUPERVISOR_OWNER_USER_ID') return ownerId;
      if (key === 'ATLAS_SUPERVISOR_OWNER_TOKEN') return OWNER_TOKEN;
      return undefined;
    },
  } as unknown as ConfigService;

  const approvals = new HumanOwnerApprovalService(config, keyRegistry as never);
  const proof = approvals.verifyAuthentication(
    {
      userId: ownerId,
      ownerAction: '1',
      ownerToken: OWNER_TOKEN,
    },
    {
      action: 'DEPLOY',
      candidate,
      service,
    },
  );

  return approvals.issueDeployApproval(proof, candidate, service);
}

describe('Production deployment external mutation idempotency', () => {
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

  async function createApprovedDeployment() {
    const task = await supervisor.createTask({
      objective: 'Bound one Human Owner approval to one Railway mutation attempt',
      owner: 'infra',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['external deployment mutation is one-shot'],
    });
    await supervisor.startTask(task.id);
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    const running = await dispatcher.markRunning(dispatched.execution.id);
    const reviewCandidate = {
      action: 'deploy_production' as const,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const completed = await dispatcher.complete(running.id, {
      summary: 'Prepared exact production deployment receipt',
      evidence: {
        rootCause: 'External deployment mutation must be claimed before Railway is touched',
        changedFiles: [CHANGED_FILE],
        tests: ['external mutation idempotency contract'],
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
    await supervisor.authorizeProductionDeployment(
      task.id,
      reviewCandidate,
      'api',
      deploymentAuthorization(supervisor, reviewCandidate, 'api'),
    );
    await supervisor.approveTask(task.id, true);

    return {
      task: await supervisor.getTask(task.id),
      execution: completed,
      reviewCandidate,
    };
  }

  function claim(taskId: string, executionId: string) {
    const contract = gateway as unknown as {
      claimProductionDeploymentMutation?: (input: {
        taskId: string;
        executionId: string;
        service: 'api';
      }) => Promise<unknown>;
    };
    expect(contract.claimProductionDeploymentMutation).toEqual(
      expect.any(Function),
    );
    return contract.claimProductionDeploymentMutation!({
      taskId,
      executionId,
      service: 'api',
    });
  }

  it('fails closed when Railway preDeploy resolves before the external mutation was claimed', async () => {
    await createApprovedDeployment();

    await expect(
      gateway.resolveProductionDeployment({
        service: 'api',
        github: CANONICAL_GITHUB,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'production_deployment_external_mutation_claim_required',
      },
    });
  });

  it('spends the Human Owner deployment authorization before any Railway mutation and cannot reclaim it', async () => {
    const { task, execution } = await createApprovedDeployment();

    await expect(claim(task.id, execution.id)).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    });

    expect(
      (await supervisor.getTask(task.id)).evidence
        ?.ownerDeploymentAuthorizationConsumption,
    ).toMatchObject({
      environment: 'production',
      consumedBy: `external-deploy-orchestrator:${execution.id}`,
      approvalJti: expect.any(String),
      candidateHash: expect.any(String),
    });

    await expect(claim(task.id, execution.id)).rejects.toMatchObject({
      response: {
        code: 'owner_deployment_authorization_already_consumed',
      },
    });
  });

  it('allows at most one winner when two external mutation claims race concurrently', async () => {
    const { task, execution } = await createApprovedDeployment();

    const outcomes = await Promise.allSettled([
      claim(task.id, execution.id),
      claim(task.id, execution.id),
    ]);

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    expect(
      (await supervisor.getTask(task.id)).evidence
        ?.ownerDeploymentAuthorizationConsumption?.consumedBy,
    ).toBe(`external-deploy-orchestrator:${execution.id}`);
  });

  it('treats an ambiguous Railway mutation outcome as spent and permits read-only reconciliation only', async () => {
    const { task, execution } = await createApprovedDeployment();
    await claim(task.id, execution.id);

    const reconciled = await supervisor.getTask(task.id);
    expect(
      reconciled.evidence?.ownerDeploymentAuthorizationConsumption?.consumedBy,
    ).toBe(`external-deploy-orchestrator:${execution.id}`);

    await expect(claim(task.id, execution.id)).rejects.toBeDefined();
  });

  it('allows Railway preDeploy only after the exact task and execution hold the pre-mutation claim', async () => {
    const { task, execution } = await createApprovedDeployment();
    await claim(task.id, execution.id);

    await expect(
      gateway.resolveProductionDeployment({
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
});
