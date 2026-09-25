import { BadRequestException, ConflictException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorService } from './agent-supervisor.service';
import {
  HumanOwnerApprovalService,
} from './authority/human-owner-approval.service';
import {
  InMemoryAuthorityKeyRegistry,
  SupervisorAuthorityService,
} from './authority/supervisor-authority.service';
import type {
  CreateSupervisorTaskInput,
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

// R2A_TEST_OWNER_ARTIFACT_ADAPTER_BEGIN
function testOwnerApprovalService(
  service: AgentSupervisorService,
): HumanOwnerApprovalService {
  const authority =
    (service as unknown as {
      authority?: {
        keyRegistry?: unknown;
      };
    }).authority;

  const keyRegistry =
    authority?.keyRegistry;

  if (!keyRegistry) {
    throw new Error(
      'test_owner_authority_keyring_missing',
    );
  }

  const config = {
    get: jest.fn(
      (key: string) => {
        if (
          key ===
          'ATLAS_SUPERVISOR_OWNER_USER_ID'
        ) {
          return 'owner-user-1';
        }

        if (
          key ===
          'ATLAS_SUPERVISOR_OWNER_TOKEN'
        ) {
          return OWNER_TOKEN;
        }

        return undefined;
      },
    ),
  } as unknown as ConfigService;

  return new HumanOwnerApprovalService(
    config,
    keyRegistry as never,
  );
}

// R2A_DIRECT_OWNER_ARTIFACT_HELPER
async function authorizeMergeAsOwner(
  service: AgentSupervisorService,
  taskId: string,
  reviewCandidate: SupervisorReviewCandidate,
  ownerId = 'owner-user-1',
) {
  const approval =
    testOwnerApprovalService(service);

  const proof =
    approval.verifyAuthentication(
      {
        userId: ownerId,
        ownerAction: '1',
        ownerToken: OWNER_TOKEN,
      },
      {
        action: 'MERGE',
        candidate: reviewCandidate,
      },
    );

  const authorization =
    approval.issueMergeApproval(
      proof,
      reviewCandidate,
    );

  return service.authorizeMerge(
    taskId,
    reviewCandidate,
    authorization,
  );
}

// R2A_DIRECT_OWNER_DEPLOY_ARTIFACT_HELPER
async function authorizeDeploymentAsOwner(
  service: AgentSupervisorService,
  taskId: string,
  reviewCandidate: SupervisorReviewCandidate,
  deploymentService:
    ProductionDeploymentService = 'api',
  ownerId = 'owner-user-1',
) {
  const approval =
    testOwnerApprovalService(service);

  const proof =
    approval.verifyAuthentication(
      {
        userId: ownerId,
        ownerAction: '1',
        ownerToken: OWNER_TOKEN,
      },
      {
        action: 'DEPLOY',
        candidate: reviewCandidate,
        service: deploymentService,
      },
    );

  const authorization =
    approval.issueDeployApproval(
      proof,
      reviewCandidate,
      deploymentService,
    );

  return service
    .authorizeProductionDeployment(
      taskId,
      reviewCandidate,
      deploymentService,
      authorization,
    );
}

function bindOwnerApprovalArtifacts(
  service: AgentSupervisorService,
): any {
  const approval =
    testOwnerApprovalService(service);

  const authorizeMerge =
    service.authorizeMerge.bind(service);

  const authorizeDeploy =
    service
      .authorizeProductionDeployment
      .bind(service);

  (
    service as unknown as {
      authorizeMerge: (
        id: string,
        candidate: SupervisorReviewCandidate,
        ownerOrAuthorization: unknown,
      ) => Promise<unknown>;
    }
  ).authorizeMerge = async (
    id,
    candidate,
    ownerOrAuthorization,
  ) => {
    if (
      typeof ownerOrAuthorization !== 'string'
    ) {
      return authorizeMerge(
        id,
        candidate,
        ownerOrAuthorization as never,
      );
    }

    const proof =
      approval.verifyAuthentication(
        {
          userId: ownerOrAuthorization,
          ownerAction: '1',
          ownerToken: OWNER_TOKEN,
        },
        {
          action: 'MERGE',
          candidate,
        },
      );

    const authorization =
      approval.issueMergeApproval(
        proof,
        candidate,
      );

    return authorizeMerge(
      id,
      candidate,
      authorization,
    );
  };

  (
    service as unknown as {
      authorizeProductionDeployment: (
        id: string,
        candidate: SupervisorReviewCandidate,
        deploymentService:
          ProductionDeploymentService,
        ownerOrAuthorization: unknown,
      ) => Promise<unknown>;
    }
  ).authorizeProductionDeployment =
    async (
      id,
      candidate,
      deploymentService,
      ownerOrAuthorization,
    ) => {
      if (
        typeof ownerOrAuthorization !==
        'string'
      ) {
        return authorizeDeploy(
          id,
          candidate,
          deploymentService,
          ownerOrAuthorization as never,
        );
      }

      const proof =
        approval.verifyAuthentication(
          {
            userId: ownerOrAuthorization,
            ownerAction: '1',
            ownerToken: OWNER_TOKEN,
          },
          {
            action: 'DEPLOY',
            candidate,
            service:
              deploymentService,
          },
        );

      const authorization =
        approval.issueDeployApproval(
          proof,
          candidate,
          deploymentService,
        );

      return authorizeDeploy(
        id,
        candidate,
        deploymentService,
        authorization,
      );
    };

  return service;
}
// R2A_TEST_OWNER_ARTIFACT_ADAPTER_END


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

function runtimeRefreshDeploymentCandidate(
  overrides: Partial<SupervisorReviewCandidate> = {},
): SupervisorReviewCandidate {
  return deploymentCandidate({
    baseSha: BASE_SHA,
    headSha: BASE_SHA,
    changedFiles: [],
    ...overrides,
  });
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
    authorization: OwnerDeploymentAuthorizationContract,
  ) => Promise<unknown>;
  assertOwnerDeploymentAuthorization?: (
    task: unknown,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ) => void;
  consumeProductionDeploymentAuthorization?: (
    id: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    consumedBy: string,
  ) => Promise<unknown>;
};

async function authorizeProductionDeployment(
  service: AgentSupervisorService,
  taskId: string,
  reviewCandidate: SupervisorReviewCandidate,
  deploymentService:
    ProductionDeploymentService = 'api',
) {
  return authorizeDeploymentAsOwner(
    service,
    taskId,
    reviewCandidate,
    deploymentService,
  );
}

async function consumeProductionDeploymentAuthorization(
  service: AgentSupervisorService,
  taskId: string,
  reviewCandidate: SupervisorReviewCandidate,
  deploymentService: ProductionDeploymentService = 'api',
  consumedBy = 'deploy-gate',
) {
  const contract = service as DeploymentAuthorizationService;
  expect(contract.consumeProductionDeploymentAuthorization).toEqual(
    expect.any(Function),
  );
  if (!contract.consumeProductionDeploymentAuthorization) return undefined;
  return contract.consumeProductionDeploymentAuthorization(
    taskId,
    reviewCandidate,
    deploymentService,
    consumedBy,
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
    testAuthority(),
  );
}

function testAuthority() {
  const fixture = () => {
    const pair = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    };
  };
  return new SupervisorAuthorityService({ get: jest.fn() } as never, new InMemoryAuthorityKeyRegistry({
    SUPERVISOR_SYSTEM: fixture(),
    WORKER_CAPABILITY: fixture(),
    VERIFIER_CAPABILITY: fixture(),
    MERGE_APPROVAL: fixture(),
    DEPLOY_APPROVAL: fixture(),
  }));
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
    testAuthority(),
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
    changedFiles: [...reviewCandidate.changedFiles],
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

  it('creates idempotent system tasks and rejects definition drift', async () => {
    const taskId =
      'ATLAS-SYS-11111111-2222-3333-4444-555555555555';
    const input: CreateSupervisorTaskInput = {
      objective: 'Executive Supervisor admission',
      owner: 'engineering',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['passes'],
    };

    const first = await service.createSystemTask(
      taskId,
      input,
    );
    const second = await service.createSystemTask(
      taskId,
      input,
    );

    expect(first.id).toBe(taskId);
    expect(second.id).toBe(first.id);
    expect((await service.listTasks())).toHaveLength(1);

    await expect(
      service.createSystemTask(taskId, {
        ...input,
        objective: 'Different admission intent',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'system_admission_idempotency_mismatch',
        taskId,
      },
    });
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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);

    const authorized = await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

    expect(authorized.evidence?.ownerMergeAuthorization).toMatchObject({
      candidate: candidate(),
      authorizedBy: 'owner-user-1',
    });
    expect(authorized.evidence?.ownerMergeAuthorization?.authorizedAt).toEqual(
      expect.any(String),
    );
    expect(authorized.evidence?.ownerMergeAuthorization?.signature).toMatch(
      /^[^.]+\.[^.]+\.[^.]+$/,
    );
  });

  it.each([
    candidate({ headSha: 'c'.repeat(40) }),
    candidate({ targetBranch: 'main' }),
    candidate({ action: 'deploy_production' }),
  ])(
    'rejects owner authorization for a non-matching or non-canonical candidate',
    async (requested) => {
      const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
      const task = await makeReadyTask(ownerService);

      await expect(
        authorizeMergeAsOwner(ownerService, task.id, requested, 'owner-user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('strips worker-supplied owner authorization from implementation evidence', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

    const working = await ownerService.returnToWorking(
      task.id,
      'candidate changed',
    );

    expect(working.status).toBe('WORKING');
    expect(working.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('persists deployment-specific owner authorization for the exact canonical deployment candidate', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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
    ).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(authorized?.evidence?.ownerMergeAuthorization).toBeUndefined();
  });

  it('authorizes an exact same-SHA zero-diff production runtime refresh', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = runtimeRefreshDeploymentCandidate();
    const task = await makeReadyTask(ownerService, reviewCandidate);

    const authorized = (await authorizeProductionDeployment(
      ownerService,
      task.id,
      reviewCandidate,
    )) as {
      evidence?: {
        ownerDeploymentAuthorization?: OwnerDeploymentAuthorizationContract;
      };
    };

    expect(authorized.evidence?.ownerDeploymentAuthorization).toMatchObject({
      candidate: reviewCandidate,
      service: 'api',
      authorizedBy: 'owner-user-1',
    });
  });

  it('rejects a same-SHA zero-diff merge candidate', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = candidate({
      baseSha: BASE_SHA,
      headSha: BASE_SHA,
      changedFiles: [],
    });
    const task = await makeReadyTask(ownerService, reviewCandidate);

    await expect(
      authorizeMergeAsOwner(
        ownerService,
        task.id,
        reviewCandidate,
        'owner-user-1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_empty_changes' },
    });
  });

  it('rejects a zero-diff production deployment when base and head differ', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = deploymentCandidate({ changedFiles: [] });
    const task = await makeReadyTask(ownerService, reviewCandidate);

    await expect(
      authorizeProductionDeployment(ownerService, task.id, reviewCandidate),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_empty_changes' },
    });
  });

  it('rejects a same-SHA zero-diff deployment outside production/atlas', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = runtimeRefreshDeploymentCandidate({
      targetBranch: 'feature/not-production',
    });
    const task = await makeReadyTask(ownerService, reviewCandidate);

    await expect(
      authorizeProductionDeployment(ownerService, task.id, reviewCandidate),
    ).rejects.toMatchObject({
      response: { code: 'review_candidate_empty_changes' },
    });
  });

  it('consumes an exact deployment approval once and records its binding', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);
    await authorizeDeploymentAsOwner(ownerService, approved.id, reviewCandidate, 'api', 'owner-user-1');

    const consumed = await consumeProductionDeploymentAuthorization(
      ownerService,
      approved.id,
      reviewCandidate,
    );

    expect(consumed).toMatchObject({
      evidence: {
        ownerDeploymentAuthorizationConsumption: {
          candidateHash: expect.any(String),
          approvalJti: expect.any(String),
          environment: 'production',
          consumedBy: 'deploy-gate',
        },
      },
    });
    await expect(
      consumeProductionDeploymentAuthorization(
        ownerService,
        approved.id,
        reviewCandidate,
      ),
    ).rejects.toMatchObject({
      response: { code: 'owner_deployment_authorization_already_consumed' },
    });
  });

  it('rejects a changed deployment candidate during consumption', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);
    await authorizeDeploymentAsOwner(ownerService, approved.id, reviewCandidate, 'api', 'owner-user-1');

    await expect(
      consumeProductionDeploymentAuthorization(
        ownerService,
        approved.id,
        deploymentCandidate({ headSha: 'c'.repeat(40) }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows exactly one winner when deploy approval consumption races', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);
    await authorizeDeploymentAsOwner(ownerService, approved.id, reviewCandidate, 'api', 'owner-user-1');

    const results = await Promise.allSettled([
      consumeProductionDeploymentAuthorization(
        ownerService,
        approved.id,
        reviewCandidate,
        'api',
        'deploy-gate-a',
      ),
      consumeProductionDeploymentAuthorization(
        ownerService,
        approved.id,
        reviewCandidate,
        'api',
        'deploy-gate-b',
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it.each([
    deploymentCandidate({ headSha: 'c'.repeat(40) }),
    deploymentCandidate({ action: 'merge' }),
  ])(
    'rejects deployment authorization for a mismatched candidate',
    async (requested) => {
      const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
      const task = await makeReadyTask(ownerService, deploymentCandidate());

      await expect(
        authorizeProductionDeployment(ownerService, task.id, requested),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each(['candidate', 'authorizedBy', 'authorizedAt', 'signature'] as const)(
    'invalidates deployment authorization after %s tampering',
    async (field) => {
      const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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
        const replacement = authorization.signature.startsWith('A') ? 'B' : 'A';
        tampered.signature = `${replacement}${authorization.signature.slice(1)}`;
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
      const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const mergeTask = await makeReadyTask(ownerService);
    const mergeAuthorized = await authorizeMergeAsOwner(ownerService, mergeTask.id, candidate(), 'owner-user-1');
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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);

    await authorizeDeploymentAsOwner(ownerService, approved.id, reviewCandidate, 'browser-worker', 'owner-user-1');

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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const reviewCandidate = deploymentCandidate();
    const ready = await makeReadyTask(ownerService, reviewCandidate);
    const approved = await ownerService.approveTask(ready.id, true);

    await authorizeDeploymentAsOwner(ownerService, approved.id, reviewCandidate, 'api', 'owner-user-1');

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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
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


  it('keeps the verifier principal read-only', () => {
    for (const action of ['read_repo', 'search_repo', 'run_tests', 'run_build'] as const) {
      expect(service.checkPermission('verifier', action)).toEqual({
        allowed: true,
        reason: null,
      });
    }
    for (const action of ['edit_assigned_files', 'commit_assigned_branch'] as const) {
      expect(service.checkPermission('verifier', action)).toEqual({
        allowed: false,
        reason: 'verifier_read_only',
      });
    }
    expect(
      service.checkPermission('verifier', 'merge', {
        explicitUserAuthorization: true,
      }).allowed,
    ).toBe(false);
    expect(service.checkPermission('verifier', 'deploy_production').allowed).toBe(false);
  });

  // ASTRA_V2_MERGE_CONSUMPTION_SERVICE_RED
  it('consumes an exact owner merge authorization once and records post-merge attestation', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

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
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

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
      authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1'),
    ).rejects.toMatchObject({
      response: { code: 'owner_merge_authorization_already_consumed' },
    });
  });

  it('does not allow a consumed reviewed task to return to WORKING', async () => {
    const ownerService = bindOwnerApprovalArtifacts(createOwnerService());
    const task = await makeReadyTask(ownerService);
    await authorizeMergeAsOwner(ownerService, task.id, candidate(), 'owner-user-1');

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

    await authorizeMergeAsOwner(ownerService, ready.id, candidate(), 'owner-user-1');

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

    await authorizeMergeAsOwner(ownerService, ready.id, candidate(), 'owner-user-1');

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

    await authorizeMergeAsOwner(ownerService, ready.id, candidate(), 'owner-user-1');

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

describe(
  'R2A signed-artifact Supervisor boundary',
  () => {
    it(
      'rejects a self-declared Human Owner artifact without a valid dedicated signature',
      async () => {
        const rawService =
          createOwnerService();

        const task =
          await makeReadyTask(
            rawService,
          );

        await expect(
          (
            rawService.authorizeMerge as unknown as (
              id: string,
              candidate: SupervisorReviewCandidate,
              authorization: unknown,
            ) => Promise<unknown>
          )(
            task.id,
            candidate(),
            {
              candidate:
                candidate(),
              authorizedBy:
                'owner-user-1',
              authorizedAt:
                '2026-09-11T12:00:00.000Z',
              signature:
                'forged-owner-signature',
            },
          ),
        ).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  },
);

// S7_HUMAN_OWNER_ABORT_RED_SERVICE
describe('S7 Human Owner abort RED service contract', () => {
  function fixture(recoveryResult: unknown = {
    execution: { status: 'CANCELLED' },
    task: { status: 'BLOCKED' },
  }) {
    const taskStore = {
      get: jest.fn().mockResolvedValue({
        id: 'ATLAS-S7-ABORT-1',
        objective: 'Abort obsolete execution',
        owner: 'backend',
        status: 'WORKING',
        allowedPaths: ['apps/api/src/a.ts'],
        forbiddenActions: ['merge', 'deploy_production'],
        dependsOn: [],
        acceptance: ['atomic abort'],
        evidence: null,
        blockingReason: null,
        failureReason: null,
        createdAt: new Date('2026-09-13T00:00:00.000Z'),
        updatedAt: new Date('2026-09-13T00:00:00.000Z'),
      }),
    };
    const fileOwnershipStore = {
      findOwner: jest.fn().mockResolvedValue('ATLAS-S7-ABORT-1'),
    };
    const recoveryStore = {
      recoverExecutionAndBlockTask: jest.fn().mockResolvedValue(recoveryResult),
    };
    const service = new AgentSupervisorService(
      taskStore as never,
      fileOwnershipStore as never,
      recoveryStore as never,
    );
    return { service, recoveryStore };
  }

  function abortMethod(service: AgentSupervisorService) {
    return (service as unknown as {
      abortTask?: (taskId: string, reason: string, ...extra: unknown[]) => Promise<unknown>;
    }).abortTask;
  }

  it('RED 4 rejects a blank abort reason before recovery mutation', async () => {
    const { service, recoveryStore } = fixture();
    const abortTask = abortMethod(service);
    expect(abortTask).toEqual(expect.any(Function));
    if (!abortTask) return;

    await expect(abortTask.call(service, 'ATLAS-S7-ABORT-1', ''))
      .rejects.toMatchObject({ response: 'abort_reason_required' });
    await expect(abortTask.call(service, 'ATLAS-S7-ABORT-1', '   '))
      .rejects.toMatchObject({ response: 'abort_reason_required' });
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledTimes(0);
  });

  it('RED 5 normalizes the abort reason exactly once', async () => {
    const { service, recoveryStore } = fixture();
    const abortTask = abortMethod(service);
    expect(abortTask).toEqual(expect.any(Function));
    if (!abortTask) return;

    await abortTask.call(service, 'ATLAS-S7-ABORT-1', '  superseded implementation  ');
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'HUMAN_OWNER_ABORT',
        taskId: 'ATLAS-S7-ABORT-1',
        reason: 'superseded implementation',
      }),
    );
  });

  it('RED 6 derives abort time from the server and ignores caller time fields', async () => {
    const { service, recoveryStore } = fixture();
    const abortTask = abortMethod(service);
    expect(abortTask).toEqual(expect.any(Function));
    if (!abortTask) return;

    const before = Date.now();
    await abortTask.call(
      service,
      'ATLAS-S7-ABORT-1',
      'stop obsolete execution',
      { now: new Date(0), completedAt: new Date(0), leaseExpiresAt: new Date(0) },
    );
    const input = recoveryStore.recoverExecutionAndBlockTask.mock.calls[0]?.[0] as {
      now?: Date;
    };
    expect(input.now).toEqual(expect.any(Date));
    expect(input.now?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('RED 7 routes Owner abort through the existing atomic recovery boundary', async () => {
    const { service, recoveryStore } = fixture();
    const abortTask = abortMethod(service);
    expect(abortTask).toEqual(expect.any(Function));
    if (!abortTask) return;

    await abortTask.call(service, 'ATLAS-S7-ABORT-1', 'stop obsolete execution');
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'HUMAN_OWNER_ABORT' }),
    );
  });

  it('RED 8 rejects null recovery without fallback or retry', async () => {
    const { service, recoveryStore } = fixture(null);
    const abortTask = abortMethod(service);
    expect(abortTask).toEqual(expect.any(Function));
    if (!abortTask) return;

    await expect(
      abortTask.call(service, 'ATLAS-S7-ABORT-1', 'stop obsolete execution'),
    ).rejects.toMatchObject({
      response: { code: 'supervisor_abort_rejected' },
    });
    expect(recoveryStore.recoverExecutionAndBlockTask).toHaveBeenCalledTimes(1);
  });
});

describe('P0B-6B candidate publication evidence', () => {
  const receipt = {
    taskId: 'ATLAS-TASK-PUBLISH-1',
    executionId: 'ATLAS-EXEC-PUBLISH-1',
    candidateBranch: 'atlas/candidate/ATLAS-TASK-PUBLISH-1/ATLAS-EXEC-PUBLISH-1',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: [CHANGED_FILE],
    targetBranch: 'production/atlas',
    remoteHeadSha: 'b'.repeat(40),
    remoteVerified: true,
  };

  it('persists a valid candidate publication receipt with implementation evidence', async () => {
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    const task = await service.createTask({
      objective: 'Persist candidate publication receipt',
      owner: 'backend',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['receipt persists'],
    });
    await service.startTask(task.id);

    const taskReceipt = {
      ...receipt,
      taskId: task.id,
      candidateBranch: `atlas/candidate/${task.id}/${receipt.executionId}`,
    };
    const implemented = await service.submitImplementation(task.id, {
      rootCause: 'Implemented', changedFiles: [CHANGED_FILE], tests: ['PASS'],
      build: 'PASS', regression: ['PASS'], deploymentState: 'NOT_DEPLOYED',
      gitState: 'CANDIDATE_PUBLISHED', remainingRisk: [],
      candidatePublication: taskReceipt,
      reviewCandidate: {
        action: 'merge', targetBranch: 'production/atlas',
        baseSha: taskReceipt.baseSha, headSha: taskReceipt.headSha,
        changedFiles: taskReceipt.changedFiles,
      },
    } as any);

    expect((implemented.evidence as any)?.candidatePublication).toEqual(taskReceipt);
  });

  it('rejects a candidate publication receipt that is not remotely verified', async () => {
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    const task = await service.createTask({
      objective: 'Reject unverified candidate receipt', owner: 'backend',
      allowedPaths: [CHANGED_FILE], forbiddenActions: ['merge'],
      dependsOn: [], acceptance: ['unverified receipt rejected'],
    });
    await service.startTask(task.id);

    await expect(service.submitImplementation(task.id, {
      rootCause: 'Implemented', changedFiles: [CHANGED_FILE], tests: ['PASS'],
      build: 'PASS', regression: ['PASS'], deploymentState: 'NOT_DEPLOYED',
      gitState: 'CANDIDATE_PUBLISHED', remainingRisk: [],
      candidatePublication: { ...receipt, remoteVerified: false },
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('P0B-6B candidate publication receipt validation', () => {
  it('rejects malformed candidate publication SHA provenance', async () => {
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(), new MemoryFileOwnershipStore(),
    );
    const task = await service.createTask({
      objective: 'Reject malformed candidate SHA', owner: 'backend',
      allowedPaths: [CHANGED_FILE], forbiddenActions: ['merge'],
      dependsOn: [], acceptance: ['invalid receipt rejected'],
    });
    await service.startTask(task.id);
    await expect(service.submitImplementation(task.id, {
      rootCause: 'Implemented', changedFiles: [CHANGED_FILE], tests: ['PASS'],
      build: 'PASS', regression: ['PASS'], deploymentState: 'NOT_DEPLOYED',
      gitState: 'CANDIDATE_PUBLISHED', remainingRisk: [],
      candidatePublication: {
        taskId: task.id, executionId: 'ATLAS-EXEC-PUBLISH-INVALID',
        candidateBranch: 'atlas/candidate/x/y', baseSha: 'not-a-sha',
        headSha: 'b'.repeat(40), changedFiles: [CHANGED_FILE],
        targetBranch: 'production/atlas', remoteHeadSha: 'b'.repeat(40),
        remoteVerified: true,
      },
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
describe('P0B-6B candidate publication binding', () => {
  async function workingTask(allowedPaths: string[]) {
    const service = new AgentSupervisorService(
      new MemorySupervisorTaskStore(), new MemoryFileOwnershipStore(),
    );
    const task = await service.createTask({
      objective: 'Bind candidate publication provenance', owner: 'backend',
      allowedPaths, forbiddenActions: ['merge'], dependsOn: [],
      acceptance: ['publication binding enforced'],
    });
    await service.startTask(task.id);
    return { service, task };
  }

  function evidence(receipt: Record<string, unknown>, changedFiles = [CHANGED_FILE]) {
    return {
      rootCause: 'Implemented', changedFiles, tests: ['PASS'], build: 'PASS',
      regression: ['PASS'], deploymentState: 'NOT_DEPLOYED',
      gitState: 'CANDIDATE_PUBLISHED', remainingRisk: [],
      candidatePublication: receipt,
      reviewCandidate: {
        action: 'merge', targetBranch: 'production/atlas',
        baseSha: receipt.baseSha, headSha: receipt.headSha, changedFiles,
      },
    } as any;
  }
  it('rejects receipt changedFiles that differ from implementation evidence', async () => {
    const other = 'apps/api/src/other.ts';
    const { service, task } = await workingTask([CHANGED_FILE, other]);
    const receipt = {
      taskId: task.id, executionId: 'ATLAS-EXEC-BIND-1',
      candidateBranch: `atlas/candidate/${task.id}/ATLAS-EXEC-BIND-1`,
      baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      changedFiles: [other], targetBranch: 'production/atlas',
      remoteHeadSha: 'b'.repeat(40), remoteVerified: true,
    };

    await expect(
      service.submitImplementation(task.id, evidence(receipt, [CHANGED_FILE])),
    ).rejects.toMatchObject({
      response: { code: 'candidate_publication_changed_files_mismatch' },
    });
  });

  it('rejects a receipt bound to a different task id', async () => {
    const { service, task } = await workingTask([CHANGED_FILE]);
    const receipt = {
      taskId: 'ATLAS-TASK-OTHER', executionId: 'ATLAS-EXEC-BIND-2',
      candidateBranch: 'atlas/candidate/ATLAS-TASK-OTHER/ATLAS-EXEC-BIND-2',
      baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      changedFiles: [CHANGED_FILE], targetBranch: 'production/atlas',
      remoteHeadSha: 'b'.repeat(40), remoteVerified: true,
    };
    await expect(
      service.submitImplementation(task.id, evidence(receipt)),
    ).rejects.toMatchObject({
      response: { code: 'candidate_publication_task_mismatch' },
    });
  });

  it('rejects reviewCandidate provenance that differs from the receipt', async () => {
    const { service, task } = await workingTask([CHANGED_FILE]);
    const receipt = {
      taskId: task.id, executionId: 'ATLAS-EXEC-BIND-3',
      candidateBranch: `atlas/candidate/${task.id}/ATLAS-EXEC-BIND-3`,
      baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      changedFiles: [CHANGED_FILE], targetBranch: 'production/atlas',
      remoteHeadSha: 'b'.repeat(40), remoteVerified: true,
    };
    const input = evidence(receipt);
    input.reviewCandidate = {
      ...input.reviewCandidate,
      headSha: 'c'.repeat(40),
    };

    await expect(
      service.submitImplementation(task.id, input),
    ).rejects.toMatchObject({
      response: { code: 'candidate_publication_review_candidate_mismatch' },
    });
  });
});

describe('existing-candidate verification lifecycle', () => {
  it('moves a blocked evidence-free task to VERIFYING while reacquiring its locks', async () => {
    const service = createOwnerService();
    const task = await service.createTask({
      objective: 'Verify immutable candidate',
      owner: 'engineering',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['verify exact candidate'],
    });
    await service.startTask(task.id);
    await service.blockTask(task.id, 'implementation execution failed');

    const admitted = await service.admitExistingCandidateVerification(task.id);

    expect(admitted.status).toBe('VERIFYING');
    expect(admitted.evidence).toBeNull();
    expect(await service.ownsAllowedPaths(task.id)).toBe(true);
  });
});
