import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  ProductionDeploymentService,
  SupervisorEvidence,
  SupervisorReviewCandidate,
} from '../agent-supervisor.types';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';
import { SupervisorCiGuard } from './supervisor-ci.guard';
import { SupervisorGatewayController } from './supervisor-gateway.controller';

const SHA = 'c'.repeat(40);
const OWNER_TOKEN = 'dispatch-owner-token';
const OWNER_ID = 'dispatch-owner-1';
const CANONICAL_GITHUB = {
  repositoryOwner: 'h7ysqm48cq-beep',
  repositoryName: 'atlas-marketing-os',
  branch: 'production/atlas',
  commitSha: SHA,
};

describe('production deployment dispatch reservation', () => {
  let supervisor: AgentSupervisorService;
  let executionStore: MemorySupervisorExecutionStore;
  let gateway: AgentGatewayService;
  let config: ConfigService;

  beforeEach(() => {
    const taskStore = new MemorySupervisorTaskStore();
    const fileStore = new MemoryFileOwnershipStore();
    executionStore = new MemorySupervisorExecutionStore();
    config = {
      get: jest.fn((key: string) => {
        if (key === 'ATLAS_SUPERVISOR_OWNER_USER_ID') return OWNER_ID;
        if (key === 'ATLAS_SUPERVISOR_OWNER_TOKEN') return OWNER_TOKEN;
        return undefined;
      }),
    } as unknown as ConfigService;
    supervisor = new AgentSupervisorService(
      taskStore,
      fileStore,
      undefined,
      config,
      createTestSupervisorAuthority(),
      undefined,
      executionStore,
    );
    gateway = new AgentGatewayService(supervisor, executionStore);
  });

  function ownerApprovals() {
    const authority = (
      supervisor as unknown as {
        authority?: { keyRegistry?: unknown };
      }
    ).authority;
    if (!authority?.keyRegistry) {
      throw new Error('dispatch_test_owner_keyring_missing');
    }
    return new HumanOwnerApprovalService(
      config,
      authority.keyRegistry as never,
    );
  }

  async function createReadyWorkerDeployment(
    service:
      | 'engineering-runner'
      | 'engineering-verifier'
      | 'browser-worker'
      | 'api'
      | 'web'
      | 'production-deploy-executor' = 'engineering-runner',
  ) {
    const allowedPath =
      service === 'engineering-runner'
        ? 'apps/engineering-runner/check-runner-production-deployment.cjs'
        : service === 'engineering-verifier'
          ? 'apps/engineering-runner/check-verifier-production-deployment.cjs'
          : service === 'browser-worker'
            ? 'apps/browser-worker/railway.json'
            : service === 'api'
            ? 'apps/api/**'
            : service === 'web'
              ? 'apps/web/**'
              : 'tools/deployment/atlas-production-deploy-executor.mjs';
    const task = await supervisor.createTask({
      objective:
        `zero-git-diff ${service} production qualification for exact canonical production SHA ${SHA}`,
      owner: 'engineering',
      allowedPaths: [allowedPath],
      forbiddenActions: [
        'edit_assigned_files',
        'commit_assigned_branch',
        'change_database_schema',
        'run_migration',
        'change_auth_or_identity',
        'change_runtime_config',
        'deploy_non_production',
        'deploy_production',
        'merge',
        'rebase',
        'squash',
        'cherry_pick',
        'auto_merge',
        'force_push',
        'delete_branch_for_integration',
      ],
      dependsOn: [],
      acceptance: [
        `baseSha=headSha=${SHA}`,
        `service=${service}`,
        'zero git diff',
        'sourceVerified=true',
        'candidatePublication absent',
      ],
    });
    await supervisor.admitExistingCandidateVerification(task.id);

    const executionId = `ATLAS-EXEC-DISPATCH-${service}`;
    const candidate: SupervisorReviewCandidate = {
      action: 'deploy_production',
      targetBranch: 'production/atlas',
      baseSha: SHA,
      headSha: SHA,
      changedFiles: [],
    };
    const proof = {
      mode: 'EXISTING_CANDIDATE' as const,
      taskId: task.id,
      executionId,
      baseSha: SHA,
      headSha: SHA,
      productionBaselineSha: SHA,
      changedFiles: [],
      gitFingerprint: 'd'.repeat(64),
      sourceVerified: true as const,
    };
    const evidence: SupervisorEvidence = {
      rootCause: 'Exact worker production candidate independently verified',
      changedFiles: [],
      tests: ['dispatch reservation verifier PASS'],
      build: 'PASS',
      regression: ['no runtime mutation'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'CLEAN',
      remainingRisk: [],
      existingCandidateVerification: proof,
      reviewCandidate: candidate,
    };
    const startedAt = new Date(Date.now() + 1000);
    const execution: SupervisorExecution = {
      id: executionId,
      taskId: task.id,
      workerRole: 'verifier',
      status: 'COMPLETED',
      assignment: {
        executionId,
        taskId: task.id,
        workerRole: 'verifier',
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        objective: task.objective,
        allowedPaths: [...task.allowedPaths],
        forbiddenActions: [...task.forbiddenActions],
        dependencies: [],
        acceptance: [...task.acceptance],
        requiredEvidence: [],
        verificationMode: 'EXISTING_CANDIDATE',
        candidateBaseSha: SHA,
        candidateHeadSha: SHA,
        productionBaselineSha: SHA,
        manifestHash: 'e'.repeat(64),
        claimEpoch: 1,
        leaseId: 'dispatch-lease-1',
        runnerId: 'independent-verifier-1',
      },
      result: {
        summary: 'Verified exact deployment candidate',
        evidence,
      },
      error: null,
      createdAt: new Date(startedAt.getTime() - 1000),
      startedAt,
      completedAt: new Date(startedAt.getTime() + 1000),
      runnerId: 'independent-verifier-1',
      claimEpoch: 1,
      lastHeartbeatAt: startedAt,
      leaseExpiresAt: new Date(startedAt.getTime() + 60_000),
    };
    await executionStore.create(execution);
    await supervisor.adoptExistingCandidateVerification(task.id, evidence);
    await supervisor.markReadyForReview(task.id);

    const approvals = ownerApprovals();
    const authentication = approvals.verifyAuthentication(
      {
        userId: OWNER_ID,
        ownerAction: '1',
        ownerToken: OWNER_TOKEN,
      },
      {
        action: 'DEPLOY',
        candidate,
        service,
      },
    );
    const authorization = approvals.issueDeployApproval(
      authentication,
      candidate,
      service,
    );
    await supervisor.authorizeProductionDeployment(
      task.id,
      candidate,
      service,
      authorization,
    );

    return { task, execution, candidate };
  }

  async function approve(taskId: string) {
    return supervisor.approveTask(taskId, true);
  }

  it('claims one exact approved worker deployment without consuming Owner authorization', async () => {
    const { task, execution, candidate } =
      await createReadyWorkerDeployment();
    await approve(task.id);

    const result = await gateway.claimProductionDeploymentDispatch({
      service: 'engineering-runner',
      github: CANONICAL_GITHUB,
      dispatcherId: 'github-actions:100:1:engineering-runner',
    });

    expect(result).toEqual({
      claimed: true,
      reason: null,
      service: 'engineering-runner',
      commitSha: SHA,
      taskId: task.id,
      executionId: execution.id,
      reservationId: expect.stringMatching(
        /^ATLAS-DISPATCH-[0-9a-f]{64}$/i,
      ),
    });

    const persisted = await supervisor.getTask(task.id);
    expect(persisted.evidence?.ownerDeploymentDispatchReservation).toEqual(
      expect.objectContaining({
        candidate,
        service: 'engineering-runner',
        reservationId: result.reservationId,
        reservedBy: 'github-actions:100:1:engineering-runner',
      }),
    );
    expect(
      persisted.evidence?.ownerDeploymentAuthorizationConsumption,
    ).toBeUndefined();
  });

  it('idempotently reclaims the exact reservation for the same stable dispatcher identity', async () => {
    const { task, execution } = await createReadyWorkerDeployment();
    await approve(task.id);

    const dispatcherId =
      'atlas-production-deploy-executor:engineering-runner';
    const first = await gateway.claimProductionDeploymentDispatch({
      service: 'engineering-runner',
      github: CANONICAL_GITHUB,
      dispatcherId,
    });
    expect(first.claimed).toBe(true);

    const afterFirst = await supervisor.getTask(task.id);
    const firstReservation =
      afterFirst.evidence?.ownerDeploymentDispatchReservation;
    expect(firstReservation).toBeDefined();

    const second = await gateway.claimProductionDeploymentDispatch({
      service: 'engineering-runner',
      github: CANONICAL_GITHUB,
      dispatcherId,
    });

    expect(second).toEqual({
      claimed: true,
      reason: null,
      service: 'engineering-runner',
      commitSha: SHA,
      taskId: task.id,
      executionId: execution.id,
      reservationId: first.reservationId,
    });

    const afterSecond = await supervisor.getTask(task.id);
    expect(afterSecond.evidence?.ownerDeploymentDispatchReservation).toEqual(
      firstReservation,
    );
    expect(
      afterSecond.evidence?.ownerDeploymentAuthorizationConsumption,
    ).toBeUndefined();
  });

  it('does not allow a different dispatcher identity to take an existing reservation', async () => {
    const { task } = await createReadyWorkerDeployment();
    await approve(task.id);

    const first = await gateway.claimProductionDeploymentDispatch({
      service: 'engineering-runner',
      github: CANONICAL_GITHUB,
      dispatcherId: 'atlas-production-deploy-executor:engineering-runner',
    });
    expect(first.claimed).toBe(true);

    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'engineering-runner',
        github: CANONICAL_GITHUB,
        dispatcherId: 'other-dispatcher:engineering-runner',
      }),
    ).resolves.toMatchObject({
      claimed: false,
      reason: 'already_reserved',
      service: 'engineering-runner',
      commitSha: SHA,
      taskId: task.id,
    });

    const persisted = await supervisor.getTask(task.id);
    expect(
      persisted.evidence?.ownerDeploymentDispatchReservation?.reservedBy,
    ).toBe('atlas-production-deploy-executor:engineering-runner');
  });

  it('does not claim a signed deployment before Human Owner task approval', async () => {
    await createReadyWorkerDeployment();

    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'engineering-runner',
        github: CANONICAL_GITHUB,
        dispatcherId: 'github-actions:103:1:engineering-runner',
      }),
    ).resolves.toEqual({
      claimed: false,
      reason: 'not_found',
      service: 'engineering-runner',
      commitSha: SHA,
    });
  });

  it('claims an approved browser-worker deployment through the bounded executor scope', async () => {
    const { task, execution } =
      await createReadyWorkerDeployment('browser-worker');
    await approve(task.id);

    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'browser-worker',
        github: CANONICAL_GITHUB,
        dispatcherId: 'atlas-production-deploy-executor:browser-worker',
      }),
    ).resolves.toMatchObject({
      claimed: true,
      reason: null,
      service: 'browser-worker',
      commitSha: SHA,
      taskId: task.id,
      executionId: execution.id,
    });
  });

  it('claims an approved api deployment through the bounded executor scope', async () => {
    const { task, execution } =
      await createReadyWorkerDeployment('api');
    await approve(task.id);

    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'api',
        github: CANONICAL_GITHUB,
        dispatcherId: 'atlas-production-deploy-executor:api',
      }),
    ).resolves.toMatchObject({
      claimed: true,
      reason: null,
      service: 'api',
      commitSha: SHA,
      taskId: task.id,
      executionId: execution.id,
    });

    const persisted = await supervisor.getTask(task.id);
    expect(
      persisted.evidence?.ownerDeploymentAuthorizationConsumption,
    ).toBeUndefined();
    expect(
      persisted.evidence?.ownerDeploymentDispatchReservation?.reservedBy,
    ).toBe('atlas-production-deploy-executor:api');
  });

  it('claims an approved web deployment through the bounded executor scope', async () => {
    const { task, execution } =
      await createReadyWorkerDeployment('web');
    await approve(task.id);

    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'web',
        github: CANONICAL_GITHUB,
        dispatcherId: 'atlas-production-deploy-executor:web',
      }),
    ).resolves.toMatchObject({
      claimed: true,
      reason: null,
      service: 'web',
      commitSha: SHA,
      taskId: task.id,
      executionId: execution.id,
    });

    const persisted = await supervisor.getTask(task.id);
    expect(
      persisted.evidence?.ownerDeploymentAuthorizationConsumption,
    ).toBeUndefined();
    expect(
      persisted.evidence?.ownerDeploymentDispatchReservation?.reservedBy,
    ).toBe('atlas-production-deploy-executor:web');
  });

  it('rejects deployment dispatch for services outside the bounded dispatch scope', async () => {
    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'datadog-agent' as never,
        github: CANONICAL_GITHUB,
        dispatcherId: 'github-actions:104:1:api',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'production_deployment_dispatch_service_unsupported',
      },
    });
  });

  it('claims an approved production-deploy-executor deployment through bounded self-dispatch', async () => {
    const { task, execution } =
      await createReadyWorkerDeployment('production-deploy-executor');
    await approve(task.id);

    await expect(
      gateway.claimProductionDeploymentDispatch({
        service: 'production-deploy-executor',
        github: CANONICAL_GITHUB,
        dispatcherId: 'atlas-production-deploy-executor:production-deploy-executor',
      }),
    ).resolves.toMatchObject({
      claimed: true,
      reason: null,
      service: 'production-deploy-executor',
      commitSha: SHA,
      taskId: task.id,
      executionId: execution.id,
      reservationId: expect.stringMatching(/^ATLAS-DISPATCH-[0-9a-f]{64}$/i),
    });

    const persisted = await supervisor.getTask(task.id);
    expect(
      persisted.evidence?.ownerDeploymentAuthorizationConsumption,
    ).toBeUndefined();
    expect(
      persisted.evidence?.ownerDeploymentDispatchReservation?.reservedBy,
    ).toBe('atlas-production-deploy-executor:production-deploy-executor');
  });

  it('blocks deployment authorization revocation after dispatch reservation', async () => {
    const { task } = await createReadyWorkerDeployment();
    await approve(task.id);
    await gateway.claimProductionDeploymentDispatch({
      service: 'engineering-runner',
      github: CANONICAL_GITHUB,
      dispatcherId: 'github-actions:105:1:engineering-runner',
    });

    await expect(
      supervisor.revokeProductionDeploymentAuthorization(
        task.id,
        'attempted post-claim revocation',
        OWNER_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'owner_deployment_dispatch_already_reserved' },
    });
  });

  it('exposes dispatch claim only behind SupervisorCiGuard', async () => {
    const result = {
      claimed: false,
      reason: 'not_found' as const,
      service: 'engineering-runner' as const,
      commitSha: SHA,
    };
    const claimProductionDeploymentDispatch = jest
      .fn()
      .mockResolvedValue(result);
    const controller = new SupervisorGatewayController({
      claimProductionDeploymentDispatch,
    } as unknown as AgentGatewayService) as unknown as {
      claimProductionDeploymentDispatch?: (input: unknown) => Promise<unknown>;
    };
    const input = {
      service: 'engineering-runner',
      github: CANONICAL_GITHUB,
      dispatcherId: 'github-actions:106:1:engineering-runner',
    };

    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupervisorGatewayController),
    ).toContain(SupervisorCiGuard);
    await expect(
      controller.claimProductionDeploymentDispatch!(input),
    ).resolves.toBe(result);
    expect(claimProductionDeploymentDispatch).toHaveBeenCalledWith(input);
  });
});
