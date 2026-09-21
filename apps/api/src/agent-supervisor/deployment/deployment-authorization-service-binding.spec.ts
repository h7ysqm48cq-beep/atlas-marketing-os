import { completeTestOnlyVerifier, testSupervisorWithVerifier } from '../testing/independent-verifier.test-fixture';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import { HumanOwnerApprovalService } from '../authority/human-owner-approval.service';
import type {
  ProductionDeploymentService,
  SupervisorReviewCandidate,
} from '../agent-supervisor.types';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const OWNER_TOKEN = 'service-binding-owner-token';

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

const CHANGED_FILE = 'apps/api/src/example.ts';

describe('Owner production deployment authorization service binding', () => {
  let supervisor: AgentSupervisorService;
  let taskStore: MemorySupervisorTaskStore;

  beforeEach(() => {
    taskStore = new MemorySupervisorTaskStore();
    const config = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
      ),
    } as unknown as ConfigService;
    supervisor = testSupervisorWithVerifier(
      taskStore,
      new MemoryFileOwnershipStore(),
      undefined,
      config,
      createTestSupervisorAuthority(),
    );
  });

  async function readyTask() {
    const task = await supervisor.createTask({
      objective: 'Prepare production deployment authorization',
      owner: 'infra',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['service-bound authorization'],
    });
    await supervisor.startTask(task.id);
    const candidate: SupervisorReviewCandidate = {
      action: 'deploy_production',
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    await supervisor.submitImplementation(task.id, {
      rootCause: 'Deployment authorization was not service-bound',
      changedFiles: [CHANGED_FILE],
      tests: ['service binding'],
      build: 'PASS',
      regression: [],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate: candidate,
    });
    await supervisor.beginVerification(task.id);
    await completeTestOnlyVerifier(supervisor, task.id);
    await supervisor.markReadyForReview(task.id);
    return { task, candidate };
  }

  async function authorize(
    taskId: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ) {
    const method = (
      supervisor as unknown as {
        authorizeProductionDeployment?: (...args: unknown[]) => Promise<unknown>;
      }
    ).authorizeProductionDeployment;
    expect(method).toEqual(expect.any(Function));
    await method!.call(
      supervisor,
      taskId,
      candidate,
      service,
      r2aDeploymentAuthorization(supervisor, candidate, service, 'owner-user-1'),
    );
    return supervisor.getTask(taskId);
  }

  function assertAuthorization(
    task: Awaited<ReturnType<AgentSupervisorService['getTask']>>,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ) {
    const method = (
      supervisor as unknown as {
        assertOwnerDeploymentAuthorization?: (...args: unknown[]) => void;
      }
    ).assertOwnerDeploymentAuthorization;
    expect(method).toEqual(expect.any(Function));
    return method!.call(supervisor, task, candidate, service);
  }

  it('persists the authorized production service alongside the exact candidate', async () => {
    const { task, candidate } = await readyTask();
    const authorized = await authorize(task.id, candidate, 'api');

    expect(
      (
        authorized.evidence?.ownerDeploymentAuthorization as
          | { service?: string }
          | undefined
      )?.service,
    ).toBe('api');
  });

  it('rejects using a valid api authorization for another service', async () => {
    const { task, candidate } = await readyTask();
    const authorized = await authorize(task.id, candidate, 'api');

    expect(() => assertAuthorization(authorized, candidate, 'web')).toThrow();
    try {
      assertAuthorization(authorized, candidate, 'web');
    } catch (error) {
      expect(error).toMatchObject({
        response: { code: 'owner_deployment_authorization_service_mismatch' },
      });
    }
  });

  it('detects service tampering because service participates in the HMAC', async () => {
    const { task, candidate } = await readyTask();
    const authorized = await authorize(task.id, candidate, 'api');
    const authorization = authorized.evidence?.ownerDeploymentAuthorization as
      | ({ service?: ProductionDeploymentService } & Record<string, unknown>)
      | undefined;
    expect(authorization).toBeDefined();
    if (!authorization) return;

    authorization.service = 'web';
    const expectedUpdatedAt =
      new Date(authorized.updatedAt);

    authorized.updatedAt =
      new Date(
        expectedUpdatedAt.getTime() + 1,
      );

    await expect(
      taskStore.saveIfUnchanged(
        authorized,
        expectedUpdatedAt,
      ),
    ).resolves.not.toBeNull();
    const tampered = await supervisor.getTask(task.id);

    expect(() => assertAuthorization(tampered, candidate, 'web')).toThrow();
    try {
      assertAuthorization(tampered, candidate, 'web');
    } catch (error) {
      expect(error).toMatchObject({
        response: { code: 'owner_deployment_authorization_invalid' },
      });
    }
  });
});
