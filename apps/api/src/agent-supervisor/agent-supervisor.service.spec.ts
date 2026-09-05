import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from './agent-supervisor.service';
import type {
  ProductionDeploymentService,
  SupervisorReviewCandidate,
  SupervisorTask,
} from './agent-supervisor.types';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';
const OWNER_TOKEN = 'test-owner-token';

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

function deploymentCandidate(
  overrides: Partial<SupervisorReviewCandidate> = {},
): SupervisorReviewCandidate {
  return candidate({ action: 'deploy_production', ...overrides });
}

interface OwnerDeploymentAuthorizationContract {
  candidate: SupervisorReviewCandidate;
  service: ProductionDeploymentService;
  authorizedBy: string;
  authorizedAt: string;
  signature: string;
}

type DeploymentAuthorizationService = AgentSupervisorService & {
  authorizeProductionDeployment?: (
    id: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    authorizedBy: string,
  ) => Promise<unknown>;
  assertOwnerDeploymentAuthorization?: (
    task: unknown,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ) => void;
};

async function authorizeProductionDeployment(
  service: AgentSupervisorService,
  taskId: string,
  reviewCandidate: SupervisorReviewCandidate,
  deploymentService: ProductionDeploymentService = 'api',
) {
  const contract = service as DeploymentAuthorizationService;
  expect(contract.authorizeProductionDeployment).toEqual(expect.any(Function));
  if (!contract.authorizeProductionDeployment) return undefined;
  return contract.authorizeProductionDeployment(
    taskId,
    reviewCandidate,
    deploymentService,
    'owner-user-1',
  );
}

class PausingMemorySupervisorTaskStore
  extends MemorySupervisorTaskStore
{
  private mutationGate: {
    entered: () => void;
    releasePromise: Promise<void>;
  } | null = null;

  armNextMutation() {
    let enteredResolve!: () => void;
    let releaseResolve!: () => void;

    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });

    const releasePromise = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });

    this.mutationGate = {
      entered: enteredResolve,
      releasePromise,
    };

    return {
      entered,
      release: () => releaseResolve(),
    };
  }

  override async saveIfUnchanged(
    task: SupervisorTask,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask | null> {
    await this.pauseMutationIfArmed();

    return super.saveIfUnchanged(
      task,
      expectedUpdatedAt,
    );
  }

  private async pauseMutationIfArmed(): Promise<void> {
    const gate = this.mutationGate;

    if (!gate) return;

    this.mutationGate = null;
    gate.entered();

    await gate.releasePromise;
  }
}

function createOwnerServiceWithStore(
  taskStore: MemorySupervisorTaskStore,
) {
  return new AgentSupervisorService(
    taskStore,
    new MemoryFileOwnershipStore(),
    undefined,
    ownerConfig(),
  );
}

function ownerConfig() {
  return {
    get: jest.fn((key: string) =>
      key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? OWNER_TOKEN : undefined,
    ),
  } as unknown as ConfigService;
}

function createOwnerService() {
  return new AgentSupervisorService(
    new MemorySupervisorTaskStore(),
    new MemoryFileOwnershipStore(),
    undefined,
    ownerConfig(),
  );
}

async function makeReadyTask(
  service: AgentSupervisorService,
  reviewCandidate: SupervisorReviewCandidate = candidate(),
) {
  const task = await service.createTask({
    objective: 'Owner authorization test',
    owner: 'backend',
    allowedPaths: [CHANGED_FILE],
    forbiddenActions: ['merge', 'deploy_production'],
    dependsOn: [],
    acceptance: ['passes'],
  });
  await service.startTask(task.id);
  await service.submitImplementation(task.id, {
    rootCause: 'Confirmed cause',
    changedFiles: [CHANGED_FILE],
    tests: ['PASS'],
    build: 'PASS',
    regression: ['PASS'],
    deploymentState: 'NOT_DEPLOYED',
    gitState: 'NO_INTEGRATION_PERFORMED',
    remainingRisk: [],
    reviewCandidate,
  });
  await service.beginVerification(task.id);
  await service.markReadyForReview(task.id);
  return service.getTask(task.id);
}

describe('AgentSupervisorService', () => {
  let service: AgentSupervisorService;

  beforeEach(() => {
    service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
  });

  it('reports prisma persistence for the runtime supervisor', async () => {
    await expect(service.status()).resolves.toMatchObject({
      persistence: 'prisma',
    });
  });

  it('creates bounded tasks in DRAFT state with restart-safe ids', async () => {
    const task = await service.createTask({
      objective: 'Fix calendar image save',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/components/Calendar.tsx'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['saved image survives reload'],
    });

    expect(task.id).toMatch(
      /^ATLAS-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(task.status).toBe('DRAFT');
    expect(task.owner).toBe('frontend');
  });

  it('generates different task ids across fresh service instances', async () => {
    const first = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    const second = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    const input = {
      objective: 'Restart-safe task id',
      owner: 'backend' as const,
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    };

    const firstTask = await first.createTask(input);
    const secondTask = await second.createTask(input);

    expect(secondTask.id).not.toBe(firstTask.id);
  });

  it('rejects owners outside the worker role whitelist', async () => {
    await expect(
      service.createTask({
        objective: 'Invalid worker task',
        owner: 'unknown-worker' as never,
        allowedPaths: ['apps/api/src/example.ts'],
        forbiddenActions: [],
        dependsOn: [],
        acceptance: ['passes'],
      }),
    ).rejects.toMatchObject({
      response: { code: 'worker_owner_required' },
    });
  });

  it('blocks a second active task that wants the same mutable file with a conflict response', async () => {
    const first = await service.createTask({
      objective: 'First task',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/components/ImageBrandEditor.tsx'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['first'],
    });
    const second = await service.createTask({
      objective: 'Second task',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/components/ImageBrandEditor.tsx'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['second'],
    });

    await service.startTask(first.id);

    await expect(service.startTask(second.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires dependencies to be READY_FOR_REVIEW or APPROVED before starting', async () => {
    const upstream = await service.createTask({
      objective: 'Backend contract',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['contract exists'],
    });
    const downstream = await service.createTask({
      objective: 'Frontend integration',
      owner: 'frontend',
      allowedPaths: ['apps/web/src/example.tsx'],
      forbiddenActions: [],
      dependsOn: [upstream.id],
      acceptance: ['integration works'],
    });

    await expect(service.startTask(downstream.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('enforces worker-to-supervisor verification progression', async () => {
    const task = await service.createTask({
      objective: 'State progression',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });

    await service.startTask(task.id);
    await service.submitImplementation(task.id, {
      rootCause: 'Confirmed cause',
      changedFiles: ['apps/api/src/example.ts'],
      tests: ['focused test PASS'],
      build: 'PASS',
      regression: ['adjacent PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
    });
    await service.beginVerification(task.id);
    const ready = await service.markReadyForReview(task.id);

    expect(ready.status).toBe('READY_FOR_REVIEW');
  });

  it('persists a signed owner merge authorization only for the exact reviewed candidate', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);

    const authorized = await ownerService.authorizeMerge(
      task.id,
      candidate(),
      'owner-user-1',
    );

    expect(authorized.evidence?.ownerMergeAuthorization).toMatchObject({
      candidate: candidate(),
      authorizedBy: 'owner-user-1',
    });
    expect(authorized.evidence?.ownerMergeAuthorization?.authorizedAt).toEqual(
      expect.any(String),
    );
    expect(authorized.evidence?.ownerMergeAuthorization?.signature).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it.each([
    candidate({ headSha: 'c'.repeat(40) }),
    candidate({ targetBranch: 'main' }),
    candidate({ action: 'deploy_production' }),
  ])(
    'rejects owner authorization for a non-matching or non-canonical candidate',
    async (requested) => {
      const ownerService = createOwnerService();
      const task = await makeReadyTask(ownerService);

      await expect(
        ownerService.authorizeMerge(task.id, requested, 'owner-user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('strips worker-supplied owner authorization from implementation evidence', async () => {
    const ownerService = createOwnerService();
    const task = await ownerService.createTask({
      objective: 'Reject forged owner evidence',
      owner: 'backend',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['forged auth is stripped'],
    });
    await ownerService.startTask(task.id);

    const implemented = await ownerService.submitImplementation(task.id, {
      rootCause: 'Attempted forged evidence',
      changedFiles: [CHANGED_FILE],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate: candidate(),
      ownerMergeAuthorization: {
        candidate: candidate(),
        authorizedBy: 'attacker',
        authorizedAt: '2026-09-01T00:00:00.000Z',
        signature: '0'.repeat(64),
      },
    });

    expect(implemented.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('revokes owner merge authorization when a reviewed task returns to working', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const working = await ownerService.returnToWorking(
      task.id,
      'candidate changed',
    );

    expect(working.status).toBe('WORKING');
    expect(working.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('persists deployment-specific owner authorization for the exact canonical deployment candidate', async () => {
    const ownerService = createOwnerService();
    const reviewCandidate = deploymentCandidate();
    const task = await makeReadyTask(ownerService, reviewCandidate);

    const authorized = (await authorizeProductionDeployment(
      ownerService,
      task.id,
      reviewCandidate,
    )) as
      | {
          evidence?: {
            ownerMergeAuthorization?: unknown;
            ownerDeploymentAuthorization?: OwnerDeploymentAuthorizationContract;
          };
        }
      | undefined;

    expect(authorized?.evidence?.ownerDeploymentAuthorization).toMatchObject({
      candidate: reviewCandidate,
      service: 'api',
      authorizedBy: 'owner-user-1',
    });
    expect(
      authorized?.evidence?.ownerDeploymentAuthorization?.authorizedAt,
    ).toEqual(expect.any(String));
    expect(
      authorized?.evidence?.ownerDeploymentAuthorization?.signature,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(authorized?.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it.each([
    deploymentCandidate({ headSha: 'c'.repeat(40) }),
    deploymentCandidate({ action: 'merge' }),
  ])(
    'rejects deployment authorization for a mismatched candidate',
    async (requested) => {
      const ownerService = createOwnerService();
      const task = await makeReadyTask(ownerService, deploymentCandidate());

      await expect(
        authorizeProductionDeployment(ownerService, task.id, requested),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each(['candidate', 'authorizedBy', 'authorizedAt', 'signature'] as const)(
    'invalidates deployment authorization after %s tampering',
    async (field) => {
      const ownerService = createOwnerService();
      const reviewCandidate = deploymentCandidate();
      const task = await makeReadyTask(ownerService, reviewCandidate);
      const authorized = (await authorizeProductionDeployment(
        ownerService,
        task.id,
        reviewCandidate,
      )) as {
        evidence: {
          ownerDeploymentAuthorization: OwnerDeploymentAuthorizationContract;
        };
      };
      const authorization = authorized.evidence.ownerDeploymentAuthorization;
      const tampered: OwnerDeploymentAuthorizationContract = {
        ...authorization,
        candidate: {
          ...authorization.candidate,
          changedFiles: [...authorization.candidate.changedFiles],
        },
      };

      if (field === 'candidate') {
        tampered.candidate.headSha = 'c'.repeat(40);
      } else if (field === 'authorizedBy') {
        tampered.authorizedBy = 'different-owner';
      } else if (field === 'authorizedAt') {
        tampered.authorizedAt = '2026-09-02T00:00:00.000Z';
      } else {
        const replacement = authorization.signature.endsWith('0') ? '1' : '0';
        tampered.signature = `${authorization.signature.slice(0, -1)}${replacement}`;
      }

      authorized.evidence.ownerDeploymentAuthorization = tampered;
      const contract = ownerService as DeploymentAuthorizationService;
      expect(contract.assertOwnerDeploymentAuthorization).toEqual(
        expect.any(Function),
      );
      if (!contract.assertOwnerDeploymentAuthorization) return;
      expect(() =>
        contract.assertOwnerDeploymentAuthorization!(
          authorized,
          reviewCandidate,
          'api',
        ),
      ).toThrow(BadRequestException);
    },
  );

  it.each(['authorizedBy', 'authorizedAt', 'signature'] as const)(
    'rejects whitespace tampering in deployment authorization %s',
    async (field) => {
      const ownerService = createOwnerService();
      const reviewCandidate = deploymentCandidate();
      const task = await makeReadyTask(ownerService, reviewCandidate);
      const authorized = (await authorizeProductionDeployment(
        ownerService,
        task.id,
        reviewCandidate,
      )) as {
        evidence: {
          ownerDeploymentAuthorization: OwnerDeploymentAuthorizationContract;
        };
      };
      const authorization = authorized.evidence.ownerDeploymentAuthorization;

      authorized.evidence.ownerDeploymentAuthorization = {
        ...authorization,
        candidate: {
          ...authorization.candidate,
          changedFiles: [...authorization.candidate.changedFiles],
        },
        [field]: `${authorization[field]} `,
      };

      const contract = ownerService as DeploymentAuthorizationService;
      expect(() =>
        contract.assertOwnerDeploymentAuthorization!(
          authorized,
          reviewCandidate,
          'api',
        ),
      ).toThrow(BadRequestException);
    },
  );

  it('domain-separates deployment authorization from a valid merge signature', async () => {
    const ownerService = createOwnerService();
    const mergeTask = await makeReadyTask(ownerService);
    const mergeAuthorized = await ownerService.authorizeMerge(
      mergeTask.id,
      candidate(),
      'owner-user-1',
    );
    const reviewCandidate = deploymentCandidate();
    const deploymentTask = (await makeReadyTask(
      ownerService,
      reviewCandidate,
    )) as typeof mergeAuthorized & {
      evidence: NonNullable<typeof mergeAuthorized.evidence> & {
        ownerDeploymentAuthorization?: OwnerDeploymentAuthorizationContract;
      };
    };
    const mergeAuthorization =
      mergeAuthorized.evidence!.ownerMergeAuthorization!;
    deploymentTask.evidence.ownerDeploymentAuthorization = {
      candidate: reviewCandidate,
      service: 'api',
      authorizedBy: mergeAuthorization.authorizedBy,
      authorizedAt: mergeAuthorization.authorizedAt,
      signature: mergeAuthorization.signature,
    };

    const contract = ownerService as DeploymentAuthorizationService;
    expect(contract.assertOwnerDeploymentAuthorization).toEqual(
      expect.any(Function),
    );
    if (!contract.assertOwnerDeploymentAuthorization) return;
    expect(() =>
      contract.assertOwnerDeploymentAuthorization!(
        deploymentTask,
        reviewCandidate,
        'api',
      ),
    ).toThrow(BadRequestException);
  });

  it('does not let deployment authorization satisfy merge authorization', async () => {
    const ownerService = createOwnerService();
    const reviewCandidate = deploymentCandidate();
    const task = await makeReadyTask(ownerService, reviewCandidate);
    const authorized = await authorizeProductionDeployment(
      ownerService,
      task.id,
      reviewCandidate,
    );

    expect(() =>
      ownerService.assertOwnerMergeAuthorization(
        authorized as never,
        reviewCandidate,
      ),
    ).toThrow(BadRequestException);
  });

  it('revokes deployment authorization from an APPROVED task without changing the reviewed candidate', async () => {
    const ownerService = createOwnerService();
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);

    await ownerService.authorizeProductionDeployment(
      approved.id,
      reviewCandidate,
      'browser-worker',
      'owner-user-1',
    );

    const before = await ownerService.getTask(approved.id);
    const beforeEvidence = before.evidence!;
    const beforeCandidate = beforeEvidence.reviewCandidate!;
    const beforeMergeAuthorization = beforeEvidence.ownerMergeAuthorization;

    const revoked = await ownerService.revokeProductionDeploymentAuthorization(
      approved.id,
      'superseded by replacement deployment task',
      'owner-user-2',
    );

    expect(revoked.status).toBe('APPROVED');

    expect(revoked.evidence?.reviewCandidate).toEqual(beforeCandidate);

    expect(revoked.evidence?.ownerMergeAuthorization).toEqual(
      beforeMergeAuthorization,
    );

    expect(revoked.evidence?.ownerDeploymentAuthorization).toBeUndefined();

    expect(
      revoked.evidence?.ownerDeploymentAuthorizationRevocations,
    ).toHaveLength(1);

    expect(
      revoked.evidence?.ownerDeploymentAuthorizationRevocations?.[0],
    ).toMatchObject({
      candidate: reviewCandidate,
      service: 'browser-worker',
      authorizedBy: 'owner-user-1',
      revokedBy: 'owner-user-2',
      reason: 'superseded by replacement deployment task',
    });

    expect(
      revoked.evidence?.ownerDeploymentAuthorizationRevocations?.[0]
        ?.authorizedAt,
    ).toEqual(expect.any(String));

    expect(
      revoked.evidence?.ownerDeploymentAuthorizationRevocations?.[0]?.revokedAt,
    ).toEqual(expect.any(String));
  });

  it('rejects deployment authorization revocation when no authorization exists', async () => {
    const ownerService = createOwnerService();
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);

    await expect(
      ownerService.revokeProductionDeploymentAuthorization(
        approved.id,
        'nothing to revoke',
        'owner-user-1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'owner_deployment_authorization_not_found',
      },
    });
  });

  it('rejects deployment authorization revocation without a reason', async () => {
    const ownerService = createOwnerService();
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);

    await ownerService.authorizeProductionDeployment(
      approved.id,
      reviewCandidate,
      'api',
      'owner-user-1',
    );

    await expect(
      ownerService.revokeProductionDeploymentAuthorization(
        approved.id,
        '   ',
        'owner-user-1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'deployment_authorization_revocation_reason_required',
      },
    });
  });

  it('revokes owner deployment authorization when a reviewed task returns to working', async () => {
    const ownerService = createOwnerService();
    const reviewCandidate = deploymentCandidate();
    const task = await makeReadyTask(ownerService, reviewCandidate);
    await authorizeProductionDeployment(ownerService, task.id, reviewCandidate);

    const working = (await ownerService.returnToWorking(
      task.id,
      'deployment candidate changed',
    )) as typeof task & {
      evidence?: typeof task.evidence & {
        ownerDeploymentAuthorization?: unknown;
      };
    };

    expect(working.status).toBe('WORKING');
    expect(working.evidence?.ownerDeploymentAuthorization).toBeUndefined();
  });

  it('denies protected git actions without explicit user authorization', () => {
    expect(
      service.checkPermission('supervisor', 'merge', {
        explicitUserAuthorization: false,
      }),
    ).toEqual({
      allowed: false,
      reason: 'explicit_user_authorization_required',
    });

    expect(
      service.checkPermission('supervisor', 'merge', {
        explicitUserAuthorization: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  it('never lets workers perform protected integration actions', () => {
    expect(
      service.checkPermission('frontend', 'merge', {
        explicitUserAuthorization: true,
      }).allowed,
    ).toBe(false);
  });

  // ASTRA_V2_MERGE_CONSUMPTION_SERVICE_RED
  it('consumes an exact owner merge authorization once and records post-merge attestation', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const contract = ownerService as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: {
          pullRequestNumber: number;
          mergeCommitSha: string;
          mergeParents: [string, string];
          mergedAt: string;
        },
        consumedBy: string,
      ) => Promise<{
        evidence?: {
          ownerMergeAuthorization?: unknown;
          ownerMergeAuthorizationConsumption?: {
            authorization: {
              candidate: SupervisorReviewCandidate;
              authorizedBy: string;
              authorizedAt: string;
              signature: string;
            };
            attestation: {
              pullRequestNumber: number;
              mergeCommitSha: string;
              mergeParents: [string, string];
              mergedAt: string;
            };
            consumedBy: string;
            consumedAt: string;
          };
        };
      }>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(expect.any(Function));
    if (!contract.consumeMergeAuthorization) return;

    const mergeSha = 'd'.repeat(40);
    const consumed = await contract.consumeMergeAuthorization(
      task.id,
      {
        pullRequestNumber: 80,
        mergeCommitSha: mergeSha,
        mergeParents: [BASE_SHA, HEAD_SHA],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      'owner-user-2',
    );

    expect(consumed.evidence?.ownerMergeAuthorization).toBeUndefined();
    expect(
      consumed.evidence?.ownerMergeAuthorizationConsumption,
    ).toMatchObject({
      authorization: {
        candidate: candidate(),
        authorizedBy: 'owner-user-1',
      },
      attestation: {
        pullRequestNumber: 80,
        mergeCommitSha: mergeSha,
        mergeParents: [BASE_SHA, HEAD_SHA],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      consumedBy: 'owner-user-2',
    });
    expect(
      consumed.evidence?.ownerMergeAuthorizationConsumption?.consumedAt,
    ).toEqual(expect.any(String));
  });

  it('rejects replay after a merge authorization has been consumed', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const contract = ownerService as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: Record<string, unknown>,
        consumedBy: string,
      ) => Promise<unknown>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(expect.any(Function));
    if (!contract.consumeMergeAuthorization) return;

    const attestation = {
      pullRequestNumber: 80,
      mergeCommitSha: 'd'.repeat(40),
      mergeParents: [BASE_SHA, HEAD_SHA],
      mergedAt: '2026-09-05T10:45:02.000Z',
    };

    await contract.consumeMergeAuthorization(
      task.id,
      attestation,
      'owner-user-2',
    );

    await expect(
      contract.consumeMergeAuthorization(
        task.id,
        attestation,
        'owner-user-2',
      ),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_already_consumed' },
    });
  });

  it('rejects post-merge attestation whose parents do not match the authorized base and head', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const contract = ownerService as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: Record<string, unknown>,
        consumedBy: string,
      ) => Promise<unknown>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(expect.any(Function));
    if (!contract.consumeMergeAuthorization) return;

    await expect(
      contract.consumeMergeAuthorization(
        task.id,
        {
          pullRequestNumber: 80,
          mergeCommitSha: 'd'.repeat(40),
          mergeParents: [BASE_SHA, 'c'.repeat(40)],
          mergedAt: '2026-09-05T10:45:02.000Z',
        },
        'owner-user-2',
      ),
    ).rejects.toMatchObject({
      response: { code: 'merge_attestation_parent_mismatch' },
    });
  });

  it('allows at most one winner when duplicate merge consumption requests race', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const contract = ownerService as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: Record<string, unknown>,
        consumedBy: string,
      ) => Promise<unknown>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(expect.any(Function));
    if (!contract.consumeMergeAuthorization) return;

    const attestation = {
      pullRequestNumber: 80,
      mergeCommitSha: 'd'.repeat(40),
      mergeParents: [BASE_SHA, HEAD_SHA],
      mergedAt: '2026-09-05T10:45:02.000Z',
    };

    const outcomes = await Promise.allSettled([
      contract.consumeMergeAuthorization(
        task.id,
        attestation,
        'owner-user-2',
      ),
      contract.consumeMergeAuthorization(
        task.id,
        attestation,
        'owner-user-2',
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);

    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );

    expect(rejected?.reason).toMatchObject({
      response: { code: 'owner_merge_authorization_already_consumed' },
    });
  });

  it('does not allow a consumed merge candidate to be re-authorized', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const contract = ownerService as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: Record<string, unknown>,
        consumedBy: string,
      ) => Promise<unknown>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(expect.any(Function));
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
      ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1'),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_already_consumed' },
    });
  });

  it('does not allow a consumed reviewed task to return to WORKING', async () => {
    const ownerService = createOwnerService();
    const task = await makeReadyTask(ownerService);
    await ownerService.authorizeMerge(task.id, candidate(), 'owner-user-1');

    const contract = ownerService as unknown as {
      consumeMergeAuthorization?: (
        taskId: string,
        attestation: Record<string, unknown>,
        consumedBy: string,
      ) => Promise<unknown>;
    };

    expect(contract.consumeMergeAuthorization).toEqual(expect.any(Function));
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
      ownerService.returnToWorking(task.id, 'change candidate'),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_already_consumed' },
    });
  });


  // ASTRA_V2_ANTI_RESURRECTION_RED
  it('rejects a stale deployment-authorization writer after merge authorization consumption wins', async () => {
    const store = new PausingMemorySupervisorTaskStore();
    const ownerService = createOwnerServiceWithStore(store);

    const ready = await makeReadyTask(
      ownerService,
      candidate(),
    );

    await ownerService.authorizeMerge(
      ready.id,
      candidate(),
      'owner-user-1',
    );

    /*
     * Seed a persisted stale/drift state representing a writer that
     * can legitimately enter the deployment-authorization path while
     * retaining a previously signed merge authorization.
     *
     * The anti-resurrection invariant must remain safe even when an
     * older persisted snapshot contains both domains.
     */
    const current = await store.get(ready.id);

    expect(current?.evidence?.ownerMergeAuthorization).toBeDefined();

    if (!current?.evidence) {
      throw new Error('test_setup_evidence_missing');
    }

    const expectedSeedUpdatedAt =
      new Date(current.updatedAt);

    const seeded =
      await store.saveIfUnchanged(
        {
          ...current,
          evidence: {
            ...current.evidence,
            reviewCandidate:
              deploymentCandidate(),
          },
          updatedAt: new Date(
            expectedSeedUpdatedAt.getTime()
              + 1,
          ),
        },
        expectedSeedUpdatedAt,
      );

    expect(seeded).not.toBeNull();

    const gate = store.armNextMutation();

    const staleDeploymentWrite =
      authorizeProductionDeployment(
        ownerService,
        ready.id,
        deploymentCandidate(),
        'api',
      );

    await gate.entered;

    await ownerService.consumeMergeAuthorization(
      ready.id,
      {
        pullRequestNumber: 80,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: [BASE_SHA, HEAD_SHA],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      'owner-user-2',
    );

    gate.release();

    const [deploymentOutcome] =
      await Promise.allSettled([
        staleDeploymentWrite,
      ]);

    expect(deploymentOutcome.status).toBe('rejected');

    const finalTask = await ownerService.getTask(ready.id);

    expect(
      finalTask.evidence?.ownerMergeAuthorization,
    ).toBeUndefined();

    expect(
      finalTask.evidence
        ?.ownerMergeAuthorizationConsumption,
    ).toBeDefined();
  });

  it('rejects a stale approveTask writer after merge authorization consumption wins', async () => {
    const store = new PausingMemorySupervisorTaskStore();
    const ownerService = createOwnerServiceWithStore(store);

    const ready = await makeReadyTask(ownerService);

    await ownerService.authorizeMerge(
      ready.id,
      candidate(),
      'owner-user-1',
    );

    const gate = store.armNextMutation();

    const staleApproval =
      ownerService.approveTask(
        ready.id,
        true,
      );

    await gate.entered;

    await ownerService.consumeMergeAuthorization(
      ready.id,
      {
        pullRequestNumber: 80,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: [BASE_SHA, HEAD_SHA],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      'owner-user-2',
    );

    gate.release();

    const [approvalOutcome] =
      await Promise.allSettled([
        staleApproval,
      ]);

    expect(approvalOutcome.status).toBe('rejected');

    const finalTask = await ownerService.getTask(ready.id);

    expect(finalTask.status).toBe(
      'READY_FOR_REVIEW',
    );

    expect(
      finalTask.evidence?.ownerMergeAuthorization,
    ).toBeUndefined();

    expect(
      finalTask.evidence
        ?.ownerMergeAuthorizationConsumption,
    ).toBeDefined();
  });

  it('rejects a stale returnToWorking writer after merge authorization consumption wins', async () => {
    const store = new PausingMemorySupervisorTaskStore();
    const ownerService = createOwnerServiceWithStore(store);

    const ready = await makeReadyTask(ownerService);

    await ownerService.authorizeMerge(
      ready.id,
      candidate(),
      'owner-user-1',
    );

    const gate = store.armNextMutation();

    const staleReturn =
      ownerService.returnToWorking(
        ready.id,
        'independent review blocker',
      );

    await gate.entered;

    await ownerService.consumeMergeAuthorization(
      ready.id,
      {
        pullRequestNumber: 80,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: [BASE_SHA, HEAD_SHA],
        mergedAt: '2026-09-05T10:45:02.000Z',
      },
      'owner-user-2',
    );

    gate.release();

    const [returnOutcome] =
      await Promise.allSettled([
        staleReturn,
      ]);

    expect(returnOutcome.status).toBe('rejected');

    const finalTask = await ownerService.getTask(ready.id);

    expect(finalTask.status).toBe(
      'READY_FOR_REVIEW',
    );

    expect(
      finalTask.evidence
        ?.ownerMergeAuthorizationConsumption,
    ).toBeDefined();
  });

});
