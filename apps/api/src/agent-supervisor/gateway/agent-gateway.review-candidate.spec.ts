import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';
import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import type { SupervisorReviewCandidate } from '../agent-supervisor.types';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { AgentGatewayService } from './agent-gateway.service';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OTHER_ALLOWED_FILE = 'apps/api/src/other.ts';
const OWNER_TOKEN = 'test-owner-merge-token';

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


function candidate(
  overrides: Partial<SupervisorReviewCandidate> = {},
): SupervisorReviewCandidate {
  return {
    action: 'merge',
    targetBranch: 'production/atlas',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    changedFiles: [CHANGED_FILE],
    ...overrides,
  };
}

function configService() {
  return {
    get: jest.fn((key: string) =>
      key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
    ),
  } as unknown as ConfigService;
}

async function makeReadyCandidate(includeReviewCandidate = true) {
  const taskStore = new MemorySupervisorTaskStore();
  const fileStore = new MemoryFileOwnershipStore();
  const executionStore = new MemorySupervisorExecutionStore();
  async function moveQueuedToLegacyDispatched(executionId: string) {
    const execution = await executionStore.get(executionId);
    if (!execution) {
      throw new Error('test_execution_missing');
    }
    expect(execution.status).toBe('QUEUED');
    execution.status = 'DISPATCHED';
    return executionStore.saveIfStatus(execution, 'QUEUED');
  }
  const supervisor = new AgentSupervisorService(
    taskStore,
    fileStore,
    undefined,
    configService(),
    createTestSupervisorAuthority(),
  );
  const dispatcher = new WorkerDispatcherService(
    supervisor,
    executionStore,
    new SupervisorWorkerCapabilityService(createTestSupervisorAuthority()),
    new SupervisorAdmissionManifestService(),
  );
  const gateway = new AgentGatewayService(supervisor, executionStore);

  const task = await supervisor.createTask({
    objective: 'Review supervised candidate',
    owner: 'backend',
    allowedPaths: [CHANGED_FILE, OTHER_ALLOWED_FILE],
    forbiddenActions: ['merge', 'deploy_production'],
    dependsOn: [],
    acceptance: ['candidate is verified'],
  });
  await supervisor.startTask(task.id);
  const queued = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
  const execution = await moveQueuedToLegacyDispatched(queued.execution.id);
  await dispatcher.markRunning(execution.id);
  const completed = await dispatcher.complete(queued.execution.id, {
    summary: 'Candidate implemented',
    evidence: {
      rootCause: 'Known cause',
      changedFiles: [CHANGED_FILE],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      ...(includeReviewCandidate ? { reviewCandidate: candidate() } : {}),
    },
  });
  await gateway.submitImplementationFromExecution(task.id, completed.id);
  await supervisor.beginVerification(task.id);
  await supervisor.markReadyForReview(task.id);

  return {
    task,
    completed,
    gateway,
    supervisor,
    taskStore,
    executionStore,
  };
}

describe('AgentGatewayService review candidate', () => {
  it('fails closed after review validation when exact owner merge authorization is missing', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_required' },
    });
  });

  it('passes only after the owner authorizes the exact reviewed candidate', async () => {
    const { task, completed, gateway, supervisor } =
      await makeReadyCandidate();
    await r2aAuthorizeMergeAsOwner(supervisor, task.id, candidate(), 'owner-user-1');

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).resolves.toEqual({
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: completed.id,
    });
  });

  it('rejects a different head SHA even when the task, execution, target, and file scope are otherwise valid', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate({ headSha: 'c'.repeat(40) }),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_mismatch' },
    });
  });

  it('rejects a different changed-file set even when every file is inside the assignment scope', async () => {
    const { task, completed, gateway } = await makeReadyCandidate();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate({ changedFiles: [OTHER_ALLOWED_FILE] }),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_mismatch' },
    });
  });

  it('rejects a stale owner authorization after review evidence is consistently moved to a new head SHA', async () => {
    const {
      task,
      completed,
      gateway,
      supervisor,
      taskStore,
      executionStore,
    } = await makeReadyCandidate();
    await r2aAuthorizeMergeAsOwner(supervisor, task.id, candidate(), 'owner-user-1');

    const nextCandidate = candidate({ headSha: 'c'.repeat(40) });
    const persistedTask = await taskStore.get(task.id);
    persistedTask!.evidence!.reviewCandidate = nextCandidate;
    const expectedUpdatedAt =
      new Date(persistedTask!.updatedAt);

    persistedTask!.updatedAt =
      new Date(
        expectedUpdatedAt.getTime() + 1,
      );

    await expect(
      taskStore.saveIfUnchanged(
        persistedTask!,
        expectedUpdatedAt,
      ),
    ).resolves.not.toBeNull();
    const persistedExecution = await executionStore.get(completed.id);
    persistedExecution!.result!.evidence.reviewCandidate = nextCandidate;
    await executionStore.save(persistedExecution!);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...nextCandidate,
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_mismatch' },
    });
  });

  it('rejects a stale owner authorization after review evidence is consistently moved to another allowed changed-file set', async () => {
    const {
      task,
      completed,
      gateway,
      supervisor,
      taskStore,
      executionStore,
    } = await makeReadyCandidate();
    await r2aAuthorizeMergeAsOwner(supervisor, task.id, candidate(), 'owner-user-1');

    const nextCandidate = candidate({ changedFiles: [OTHER_ALLOWED_FILE] });
    const persistedTask = await taskStore.get(task.id);
    persistedTask!.evidence!.changedFiles = [OTHER_ALLOWED_FILE];
    persistedTask!.evidence!.reviewCandidate = nextCandidate;
    const expectedUpdatedAt =
      new Date(persistedTask!.updatedAt);

    persistedTask!.updatedAt =
      new Date(
        expectedUpdatedAt.getTime() + 1,
      );

    await expect(
      taskStore.saveIfUnchanged(
        persistedTask!,
        expectedUpdatedAt,
      ),
    ).resolves.not.toBeNull();
    const persistedExecution = await executionStore.get(completed.id);
    persistedExecution!.result!.evidence.changedFiles = [OTHER_ALLOWED_FILE];
    persistedExecution!.result!.evidence.reviewCandidate = nextCandidate;
    await executionStore.save(persistedExecution!);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...nextCandidate,
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_mismatch' },
    });
  });

  it('rejects a forged owner authorization even when its candidate fields match exactly', async () => {
    const { task, completed, gateway, taskStore } = await makeReadyCandidate();
    const persistedTask = await taskStore.get(task.id);
    persistedTask!.evidence!.ownerMergeAuthorization = {
      candidate: candidate(),
      authorizedBy: 'attacker',
      authorizedAt: '2026-09-01T00:00:00.000Z',
      signature: '0'.repeat(64),
    };
    const expectedUpdatedAt =
      new Date(persistedTask!.updatedAt);

    persistedTask!.updatedAt =
      new Date(
        expectedUpdatedAt.getTime() + 1,
      );

    await expect(
      taskStore.saveIfUnchanged(
        persistedTask!,
        expectedUpdatedAt,
      ),
    ).resolves.not.toBeNull();

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_invalid' },
    });
  });

  it('fails closed for legacy evidence that never recorded an exact review candidate', async () => {
    const { task, completed, gateway } = await makeReadyCandidate(false);

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_not_recorded' },
    });
  });

  // ASTRA_V2_CONSUMED_GATE_RED
  it('fails closed after the exact merge authorization has been consumed', async () => {
    const { task, completed, gateway, supervisor } =
      await makeReadyCandidate();

    await r2aAuthorizeMergeAsOwner(supervisor, task.id, candidate(), 'owner-user-1');

    const contract = supervisor as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: Record<string, unknown>,
        consumedBy: string,
      ) => Promise<unknown>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(
      expect.any(Function),
    );

    if (!contract.consumeMergeAuthorization) return;

    await contract.consumeMergeAuthorization(
      task.id,
      {
        pullRequestNumber: 80,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: [BASE_SHA, HEAD_SHA],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      'owner-user-2',
    );

    await expect(
      gateway.checkReviewCandidate({
        taskId: task.id,
        executionId: completed.id,
        ...candidate(),
        explicitUserAuthorization: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_required' },
    });
  });

});
