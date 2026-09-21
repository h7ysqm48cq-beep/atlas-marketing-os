import { completeTestOnlyVerifier, testSupervisorWithVerifier } from './testing/independent-verifier.test-fixture';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorModule } from './agent-supervisor.module';
import { AgentSupervisorService } from './agent-supervisor.service';
import { SupervisorAdmissionManifestService } from './authority/supervisor-admission-manifest.service';
import {
  HumanOwnerApprovalService,
} from './authority/human-owner-approval.service';
import { createTestSupervisorAuthority } from './authority/test-authority';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { SupervisorWorkerCapabilityService } from './worker/supervisor-worker-capability.service';
import { SupervisorOwnerActionGuard } from './gateway/supervisor-owner-action.guard';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from './stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const CHANGED_FILE = 'apps/api/src/example.ts';

// R2A_CONTROLLER_OWNER_SIGNER_TEST_HELPER
type ControllerOwnerRequest = {
  user?: {
    id?: string;
  };
  headers?: Record<
    string,
    string | string[] | undefined
  >;
};

function createControllerOwnerSigner(
  supervisor: unknown,
): HumanOwnerApprovalService {
  const holder =
    supervisor as unknown as {
      authority?: unknown;
    };

  if (!holder.authority) {
    holder.authority =
      createTestSupervisorAuthority();
  }

  const authority =
    holder.authority as unknown as {
      keyRegistry?: unknown;
    };

  const keyRegistry =
    authority.keyRegistry;

  if (!keyRegistry) {
    throw new Error(
      'controller_test_keyring_missing',
    );
  }

  const config = {
    get: jest.fn(
      (key: string) => {
        if (
          key ===
          'ATLAS_SUPERVISOR_OWNER_USER_ID'
        ) {
          return 'authenticated-owner-id';
        }

        if (
          key ===
          'ATLAS_SUPERVISOR_OWNER_TOKEN'
        ) {
          return 'controller-owner-token';
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

describe('AgentSupervisorController', () => {
  let supervisor: AgentSupervisorService;
  let dispatcher: WorkerDispatcherService;
  let controller: AgentSupervisorController;

  beforeEach(() => {
    supervisor = testSupervisorWithVerifier(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
    );
    dispatcher = new WorkerDispatcherService(
      supervisor,
      new MemorySupervisorExecutionStore(),
      new SupervisorWorkerCapabilityService(createTestSupervisorAuthority()),
      new SupervisorAdmissionManifestService(),
    );
    controller = new AgentSupervisorController(supervisor, dispatcher,
      createControllerOwnerSigner(supervisor));
  });

  it('runs the trusted owner-action boundary before the existing owner guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AgentSupervisorController,
    ) as unknown[];

    expect(guards).toEqual([SupervisorOwnerActionGuard, SupervisorOwnerGuard]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentSupervisorModule),
    ).toContain(SupervisorOwnerActionGuard);
  });

  it('creates merge authorization from authenticated request identity without accepting an approval boolean', async () => {
    const ownerConfig = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN'
          ? 'controller-owner-token'
          : undefined,
      ),
    } as unknown as ConfigService;
    const ownerSupervisor = testSupervisorWithVerifier(
      new MemorySupervisorTaskStore(),
      new MemoryFileOwnershipStore(),
      undefined,
      ownerConfig,
      createTestSupervisorAuthority(),
    );
    const ownerDispatcher = new WorkerDispatcherService(
      ownerSupervisor,
      new MemorySupervisorExecutionStore(),
      new SupervisorWorkerCapabilityService(createTestSupervisorAuthority()),
      new SupervisorAdmissionManifestService(),
    );
    const ownerController = new AgentSupervisorController(
      ownerSupervisor,
      ownerDispatcher,
      createControllerOwnerSigner(ownerSupervisor));
    const reviewCandidate = {
      action: 'merge' as const,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const task = await ownerSupervisor.createTask({
      objective: 'Authorize exact merge candidate',
      owner: 'backend',
      allowedPaths: [CHANGED_FILE],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['authorized only by owner'],
    });
    await ownerSupervisor.startTask(task.id);
    await ownerSupervisor.submitImplementation(task.id, {
      rootCause: 'Known cause',
      changedFiles: [CHANGED_FILE],
      tests: ['PASS'],
      build: 'PASS',
      regression: ['PASS'],
      deploymentState: 'NOT_DEPLOYED',
      gitState: 'NO_INTEGRATION_PERFORMED',
      remainingRisk: [],
      reviewCandidate,
    });
    await ownerSupervisor.beginVerification(task.id);
    await completeTestOnlyVerifier(ownerSupervisor, task.id);
    await ownerSupervisor.markReadyForReview(task.id);

    const authorized = await ownerController.authorizeMerge(
      task.id,
      { candidate: reviewCandidate },
      ({
        user: {
          id: 'authenticated-owner-id',
        },
        headers: {
          'x-atlas-supervisor-owner-action':
            '1',
          'x-atlas-supervisor-owner-token':
            'controller-owner-token',
        },
      } as ControllerOwnerRequest),
    );

    expect(authorized.evidence?.ownerMergeAuthorization).toMatchObject({
      candidate: reviewCandidate,
      authorizedBy: 'authenticated-owner-id',
    });
    expect(
      (
        ownerController as unknown as {
          authorizeMerge: (...args: unknown[]) => unknown;
        }
      ).authorizeMerge.length,
    ).toBe(3);
  });

  it('creates deployment authorization from authenticated owner identity without caller authority fields', async () => {
    const reviewCandidate = {
      action: 'deploy_production' as const,
      targetBranch: 'production/atlas',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFiles: [CHANGED_FILE],
    };
    const decision = { evidence: { ownerDeploymentAuthorization: {} } };
    const authorizeProductionDeployment = jest.fn().mockResolvedValue(decision);
    const ownerController = new AgentSupervisorController(
      { authorizeProductionDeployment } as unknown as AgentSupervisorService,
      {} as WorkerDispatcherService,
      createControllerOwnerSigner({ authorizeProductionDeployment } as unknown as AgentSupervisorService)) as unknown as {
      authorizeProductionDeployment?: (
        id: string,
        body: Record<string, unknown>,
        request: { user?: { id?: string } },
      ) => Promise<unknown>;
    };

    expect(ownerController.authorizeProductionDeployment).toEqual(
      expect.any(Function),
    );
    if (!ownerController.authorizeProductionDeployment) return;
    await expect(
      ownerController.authorizeProductionDeployment(
        'ATLAS-DEPLOY-1',
        {
          candidate: reviewCandidate,
          service: 'api',
          explicitUserAuthorization: true,
          authorizedBy: 'caller-controlled-owner',
          signature: 'f'.repeat(64),
        },
        ({
        user: {
          id: 'authenticated-owner-id',
        },
        headers: {
          'x-atlas-supervisor-owner-action':
            '1',
          'x-atlas-supervisor-owner-token':
            'controller-owner-token',
        },
      } as ControllerOwnerRequest),
      ),
    ).resolves.toBe(decision);
    expect(authorizeProductionDeployment).toHaveBeenCalledWith(
      'ATLAS-DEPLOY-1',
      reviewCandidate,
      'api',
      expect.objectContaining({
        candidate: reviewCandidate,
        service: 'api',
        authorizedBy: 'authenticated-owner-id',
        authorizedAt: expect.any(String),
        signature: expect.any(String),
      }),
    );

    const deploymentAuthorization =
      authorizeProductionDeployment.mock.calls[0]?.[3];

    expect(
      deploymentAuthorization?.signature,
    ).toMatch(
      /^[^.]+\.[^.]+\.[^.]+$/,
    );
  });

  it('revokes deployment authorization using authenticated owner identity only', async () => {
    const decision = {
      status: 'APPROVED',
      evidence: {
        ownerDeploymentAuthorization: undefined,
      },
    };

    const revokeProductionDeploymentAuthorization = jest
      .fn()
      .mockResolvedValue(decision);

    const ownerController = new AgentSupervisorController(
      {
        revokeProductionDeploymentAuthorization,
      } as unknown as AgentSupervisorService,
      {} as WorkerDispatcherService,
      createControllerOwnerSigner({
        revokeProductionDeploymentAuthorization,
      } as unknown as AgentSupervisorService)) as unknown as {
      revokeProductionDeploymentAuthorization?: (
        id: string,
        body: Record<string, unknown>,
        request: { user?: { id?: string } },
      ) => Promise<unknown>;
    };

    expect(ownerController.revokeProductionDeploymentAuthorization).toEqual(
      expect.any(Function),
    );

    if (!ownerController.revokeProductionDeploymentAuthorization) {
      return;
    }

    await expect(
      ownerController.revokeProductionDeploymentAuthorization(
        'ATLAS-DEPLOY-1',
        {
          reason: 'superseded candidate',
          revokedBy: 'caller-controlled-owner',
        },
        {
          user: {
            id: 'authenticated-owner-id',
          },
        },
      ),
    ).resolves.toBe(decision);

    expect(revokeProductionDeploymentAuthorization).toHaveBeenCalledWith(
      'ATLAS-DEPLOY-1',
      'superseded candidate',
      'authenticated-owner-id',
    );
  });

  it('dispatches a task without accepting role or permission overrides', async () => {
    const task = await supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      dependsOn: [],
      acceptance: ['passes'],
    });
    await supervisor.startTask(task.id);

    const result = await controller.dispatchTask(task.id);

    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.forbiddenActions).toContain('merge');
  });

  it('forwards only frozenBaseSha from the implementation dispatch body', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      execution: { id: 'ATLAS-EXEC-BASE-1', status: 'QUEUED' },
    });
    const dispatchController = Object.create(
      AgentSupervisorController.prototype,
    ) as any;
    dispatchController.dispatcher = { dispatch };

    const frozenBaseSha = 'A'.repeat(40);
    await dispatchController.dispatchTask('ATLAS-TASK-BASE-1', {
      frozenBaseSha,
      manifestHash: 'caller-controlled',
      runnerId: 'caller-controlled',
    });

    expect(dispatch).toHaveBeenCalledWith(
      'ATLAS-TASK-BASE-1',
      'IMPLEMENTATION',
      { frozenBaseSha },
    );
  });

  it('exposes a server-fixed Human Owner verifier dispatch route', () => {
    const prototype =
      AgentSupervisorController.prototype as unknown as Record<
        string,
        unknown
      >;
    const method =
      prototype.dispatchVerificationTask as object;

    expect(method).toEqual(expect.any(Function));
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      'tasks/:id/dispatch-verification',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
      RequestMethod.POST,
    );
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AgentSupervisorController,
      ),
    ).toEqual([
      SupervisorOwnerActionGuard,
      SupervisorOwnerGuard,
    ]);
  });

  it('dispatches verifier work with a server-fixed execution purpose', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      execution: {
        id: 'ATLAS-EXEC-VERIFY-1',
        status: 'QUEUED',
      },
    });
    const verifierController =
      new AgentSupervisorController(
        {} as AgentSupervisorService,
        { dispatch } as unknown as WorkerDispatcherService,
      ) as unknown as {
        dispatchVerificationTask?: (
          id: string,
          callerControlledPurpose?: string,
        ) => Promise<unknown>;
      };

    expect(
      verifierController.dispatchVerificationTask,
    ).toEqual(expect.any(Function));

    if (!verifierController.dispatchVerificationTask) {
      return;
    }

    await verifierController.dispatchVerificationTask(
      'ATLAS-TASK-VERIFY-1',
      'IMPLEMENTATION',
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      'ATLAS-TASK-VERIFY-1',
      'INDEPENDENT_VERIFICATION',
    );
  });

  it('lists execution history for a task', async () => {
    const task = await supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });
    await supervisor.startTask(task.id);
    await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(await controller.listExecutions(task.id)).toHaveLength(1);
  });

  it('gets one execution by id', async () => {
    const task = await supervisor.createTask({
      objective: 'Backend task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });
    await supervisor.startTask(task.id);
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    await expect(
      controller.getExecution(dispatched.execution.id),
    ).resolves.toEqual(dispatched.execution);
  });

  // ASTRA_V2_CONSUME_CONTROLLER_RED
  it('consumes merge authorization using authenticated owner identity rather than caller identity fields', async () => {
    const decision = {
      status: 'APPROVED',
      evidence: {
        ownerMergeAuthorization: undefined,
        ownerMergeAuthorizationConsumption: {},
      },
    };

    const consumeMergeAuthorization = jest
      .fn()
      .mockResolvedValue(decision);

    const ownerController = new AgentSupervisorController(
      {
        consumeMergeAuthorization,
      } as unknown as AgentSupervisorService,
      {} as WorkerDispatcherService,
      createControllerOwnerSigner({
        consumeMergeAuthorization,
      } as unknown as AgentSupervisorService)) as unknown as {
      consumeMergeAuthorization?: (
        id: string,
        body: Record<string, unknown>,
        request: { user?: { id?: string } },
      ) => Promise<unknown>;
    };

    expect(ownerController.consumeMergeAuthorization).toEqual(
      expect.any(Function),
    );

    if (!ownerController.consumeMergeAuthorization) return;

    const attestation = {
      pullRequestNumber: 80,
      mergeCommitSha: 'd'.repeat(40),
      mergeParents: [BASE_SHA, HEAD_SHA],
      mergedAt: '2026-09-05T10:45:02.000Z',
    };

    await expect(
      ownerController.consumeMergeAuthorization(
        'ATLAS-MERGE-1',
        {
          attestation,
          consumedBy: 'caller-controlled-owner',
        },
        {
          user: {
            id: 'authenticated-owner-id',
          },
        },
      ),
    ).resolves.toBe(decision);

    expect(consumeMergeAuthorization).toHaveBeenCalledWith(
      'ATLAS-MERGE-1',
      attestation,
      'authenticated-owner-id',
    );
  });

});

// R1_BOOTSTRAP_ADMISSION_RED_BEGIN
describe('R1 bootstrap admission authority boundary', () => {
  it('does not allow the HTTP dispatch caller to choose execution authority binding', async () => {
    const { AgentSupervisorController } =
      require('./agent-supervisor.controller');

    const dispatcher = {
      dispatch: jest.fn().mockResolvedValue({
        execution: { id: 'ATLAS-EXEC-RED', status: 'DISPATCHED' },
      }),
    };

    const controller = Object.create(
      AgentSupervisorController.prototype,
    ) as any;

    controller.dispatcher = dispatcher;

    const clientSuppliedBinding = {
      manifestHash: 'a'.repeat(64),
      claimEpoch: 999,
      leaseId: 'client-controlled-lease',
      runnerId: 'client-controlled-runner',
    };

    await (controller.dispatchTask as any)(
      'ATLAS-TASK-RED',
      clientSuppliedBinding,
    );

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      'ATLAS-TASK-RED',
      'IMPLEMENTATION',
    );
  });
});

// S7_HUMAN_OWNER_ABORT_RED_CONTROLLER
describe('S7 Human Owner abort RED contract', () => {
  const taskId = 'ATLAS-S7-ABORT-1';
  const body = {
    reason: 'Owner stopped obsolete execution',
    executionId: 'caller-controlled-execution',
    status: 'COMPLETED',
    claimEpoch: 999,
    runnerId: 'caller-runner',
    leaseId: 'caller-lease',
    ownerId: 'caller-owner',
  };

  it('RED 1 exposes the exact Human Owner abort POST route', () => {
    const prototype = AgentSupervisorController.prototype as unknown as Record<
      string,
      unknown
    >;
    const abortTask = prototype.abortTask as object;

    expect(abortTask).toEqual(expect.any(Function));
    expect(Reflect.getMetadata(PATH_METADATA, abortTask)).toBe('tasks/:id/abort');
    expect(Reflect.getMetadata(METHOD_METADATA, abortTask)).toBe(
      RequestMethod.POST,
    );
  });

  it('RED 2 keeps abort behind the existing Owner guards only', () => {
    const prototype = AgentSupervisorController.prototype as unknown as Record<
      string,
      unknown
    >;
    const abortTask = prototype.abortTask;
    expect(abortTask).toEqual(expect.any(Function));

    expect(
      Reflect.getMetadata(GUARDS_METADATA, AgentSupervisorController),
    ).toEqual([SupervisorOwnerActionGuard, SupervisorOwnerGuard]);
  });

  it('RED 3 ignores caller execution and owner binding fields', async () => {
    const abort = (AgentSupervisorController.prototype as unknown as Record<
      string,
      unknown
    >).abortTask as
      | ((id: string, body: Record<string, unknown>, request: unknown) => Promise<unknown>)
      | undefined;
    expect(abort).toEqual(expect.any(Function));
    if (!abort) return;

    const abortTask = jest.fn().mockResolvedValue({ status: 'BLOCKED' });
    const controller = new AgentSupervisorController(
      { abortTask } as unknown as AgentSupervisorService,
      {} as WorkerDispatcherService,
      undefined,
    );

    await abort.call(
      controller,
      taskId,
      body,
      { user: { id: 'authenticated-owner' } },
    );

    expect(abortTask).toHaveBeenCalledWith(taskId, body.reason);
    expect(abortTask).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ executionId: expect.any(String) }),
    );
  });

  it('RED 16 does not acquire merge, deploy, or runtime-config authority', () => {
    const prototype = AgentSupervisorController.prototype as unknown as Record<
      string,
      unknown
    >;
    const abortTask = prototype.abortTask;
    expect(abortTask).toEqual(expect.any(Function));

    const source = String(abortTask);
    expect(source).not.toMatch(
      /authorizeMerge|authorizeProductionDeployment|consumeMergeAuthorization|issueMergeApproval|issueDeployApproval/,
    );
  });
});
// R1_BOOTSTRAP_ADMISSION_RED_END
