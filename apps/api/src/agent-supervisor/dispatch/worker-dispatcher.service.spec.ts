import { BadRequestException, ConflictException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import {
  InMemoryAuthorityKeyRegistry,
  SupervisorAuthorityService,
} from '../authority/supervisor-authority.service';
import { MemoryFileOwnershipStore } from '../stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from '../stores/memory-supervisor-task.store';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import { WorkerDispatcherService } from './worker-dispatcher.service';

const PROTECTED_ACTIONS = [
  'merge',
  'rebase',
  'squash',
  'cherry_pick',
  'auto_merge',
  'force_push',
  'delete_branch_for_integration',
];

const VERIFIER_FORBIDDEN_ACTIONS = [
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
];

function capabilityAuthority(): SupervisorAuthorityService {
  const key = () => {
    const pair = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    };
  };
  return new SupervisorAuthorityService({ get: jest.fn() } as never, new InMemoryAuthorityKeyRegistry({
    SUPERVISOR_SYSTEM: key(),
    WORKER_CAPABILITY: key(),
    VERIFIER_CAPABILITY: key(),
    MERGE_APPROVAL: key(),
    DEPLOY_APPROVAL: key(),
  }));
}

describe('WorkerDispatcherService', () => {
  let supervisor: AgentSupervisorService;
  let fileStore: MemoryFileOwnershipStore;
  let executionStore: MemorySupervisorExecutionStore;
  let dispatcher: WorkerDispatcherService;

  beforeEach(() => {
    const taskStore = new MemorySupervisorTaskStore();
    fileStore = new MemoryFileOwnershipStore();
    executionStore = new MemorySupervisorExecutionStore();
    supervisor = new AgentSupervisorService(taskStore, fileStore);
    dispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
      new SupervisorWorkerCapabilityService(capabilityAuthority()),
      new SupervisorAdmissionManifestService(),
    );
  });

  async function createWorkingTask() {
    const task = await supervisor.createTask({
      objective: 'Implement backend change',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['focused tests pass'],
    });
    return supervisor.startTask(task.id);
  }

  async function createVerifyingTask() {
    const task = await createWorkingTask();
    await supervisor.submitImplementation(
      task.id,
      workerResult().evidence,
    );
    return supervisor.beginVerification(task.id);
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

  function workerResult() {
    return {
      summary: 'Implemented',
      evidence: {
        rootCause: 'Known cause',
        changedFiles: ['apps/api/src/example.ts'],
        tests: ['focused test PASS'],
        build: 'PASS',
        regression: ['adjacent PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
      },
    };
  }

  it('dispatch remains QUEUED', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(result.execution.status).toBe('QUEUED');
    await expect(executionStore.listByTask(task.id)).resolves.toMatchObject([
      { status: 'QUEUED' },
    ]);
  });

  it('dispatch does not issue or expose a Worker capability before claim', async () => {
    const task = await createWorkingTask();
    const capabilityService = new SupervisorWorkerCapabilityService(
      capabilityAuthority(),
    );
    const issueSpy = jest.spyOn(capabilityService, 'issue');
    const capabilityDispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
      capabilityService,
      new SupervisorAdmissionManifestService(),
    );

    const result = await capabilityDispatcher.dispatch(
      task.id,
      'IMPLEMENTATION',
    );

    expect(issueSpy).not.toHaveBeenCalled();
    expect(result.capability).toBeUndefined();
    expect(result.assignment.workerCapability).toBeUndefined();
    const [persisted] = await executionStore.listByTask(task.id);
    expect(persisted.assignment.workerCapability).toBeUndefined();
  });

  it('dispatch can queue work when Worker capability service is unavailable', async () => {
    const task = await createWorkingTask();
    const dispatcherWithoutCapability = new WorkerDispatcherService(
      supervisor,
      executionStore,
      undefined as never,
      new SupervisorAdmissionManifestService(),
    );

    const result = await dispatcherWithoutCapability.dispatch(
      task.id,
      'IMPLEMENTATION',
    );
    expect(result).toMatchObject({
      execution: { status: 'QUEUED' },
    });
    expect(result.capability).toBeUndefined();
  });

  it('dispatch queues INDEPENDENT_VERIFICATION without issuing a verifier capability', async () => {
    const task = await createVerifyingTask();

    const result = await dispatcher.dispatch(
      task.id,
      'INDEPENDENT_VERIFICATION',
    );
    expect(result).toMatchObject({
      execution: {
        status: 'QUEUED',
        assignment: {
          executionPurpose: 'INDEPENDENT_VERIFICATION',
          workerCapability: undefined,
        },
      },
    });
    expect(result.capability).toBeUndefined();
  });

  it('dispatch performs only one persistence creation step', async () => {
    const task = await createWorkingTask();
    const executionStore = {
      listByTask: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (execution: any) => execution),
      saveIfStatus: jest
        .fn()
        .mockImplementation(async (execution: any) => execution),
    };
    const capabilityService = {
      issue: jest.fn().mockReturnValue({
        token: 'REDACTED_TEST_CAPABILITY',
        metadata: {},
      }),
    };
    const persistenceDispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore as never,
      capabilityService as never,
      new SupervisorAdmissionManifestService(),
    );

    await persistenceDispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(executionStore.create).toHaveBeenCalledTimes(1);
    expect(executionStore.saveIfStatus).not.toHaveBeenCalled();
    expect(executionStore.create.mock.calls[0][0]).toMatchObject({
      status: 'QUEUED',
      runnerId: null,
      claimEpoch: 0,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
    });
  });

  it('dispatches a WORKING task with owned files and a restart-safe execution id', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(result.execution.status).toBe('QUEUED');
    expect(result.execution.id).toMatch(
      /^ATLAS-EXEC-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.assignment.taskId).toBe(task.id);
    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.allowedPaths).toEqual(task.allowedPaths);
  });

  it('records IMPLEMENTATION as the default execution purpose', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(
      (result.assignment as { executionPurpose?: string }).executionPurpose,
    ).toBe('IMPLEMENTATION');
  });

  it('binds a normalized frozen base SHA into the implementation assignment and admission input', async () => {
    const task = await createWorkingTask();
    const createBinding = jest.fn((input: Record<string, unknown>) =>
      new SupervisorAdmissionManifestService().createBinding(input as never),
    );
    const boundDispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
      new SupervisorWorkerCapabilityService(capabilityAuthority()),
      { createBinding } as never,
    );
    const base = 'A'.repeat(40);

    const result = await (boundDispatcher as unknown as {
      dispatch(
        taskId: string,
        purpose: 'IMPLEMENTATION',
        options: { frozenBaseSha: string },
      ): ReturnType<WorkerDispatcherService['dispatch']>;
    }).dispatch(task.id, 'IMPLEMENTATION', { frozenBaseSha: base });

    expect((result.assignment as unknown as Record<string, unknown>).frozenBaseSha).toBe(
      base.toLowerCase(),
    );
    expect(createBinding).toHaveBeenCalledWith(
      expect.objectContaining({ frozenBaseSha: base.toLowerCase() }),
    );
  });

  it('rejects a malformed frozen base SHA before persistence', async () => {
    const task = await createWorkingTask();

    await expect(
      (dispatcher as unknown as {
        dispatch(
          taskId: string,
          purpose: 'IMPLEMENTATION',
          options: { frozenBaseSha: string },
        ): ReturnType<WorkerDispatcherService['dispatch']>;
      }).dispatch(task.id, 'IMPLEMENTATION', { frozenBaseSha: 'not-a-sha' }),
    ).rejects.toThrow('frozen_base_sha_invalid');

    expect(await executionStore.listByTask(task.id)).toHaveLength(0);
  });

  it('rejects a caller-supplied frozen base for independent verification', async () => {
    const task = await createVerifyingTask();

    await expect(
      (dispatcher as unknown as {
        dispatch(
          taskId: string,
          purpose: 'INDEPENDENT_VERIFICATION',
          options: { frozenBaseSha: string },
        ): ReturnType<WorkerDispatcherService['dispatch']>;
      }).dispatch(task.id, 'INDEPENDENT_VERIFICATION', {
        frozenBaseSha: 'a'.repeat(40),
      }),
    ).rejects.toThrow('frozen_base_sha_not_allowed_for_verification');
  });

  it('fails closed when the server admission producer returns a malformed binding', async () => {
    const task = await createWorkingTask();

    const malformedAdmissionManifestService = {
      createBinding: jest.fn().mockReturnValue({
        manifestHash: 'not-a-valid-sha256',
        claimEpoch: 0,
        leaseId: 'server-lease',
        runnerId: 'server-runner',
      }),
    };

    const capabilityDispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
      new SupervisorWorkerCapabilityService(capabilityAuthority()),
      malformedAdmissionManifestService as never,
    );

    await expect(
      capabilityDispatcher.dispatch(task.id),
    ).rejects.toThrow(
      'worker_capability_authority_binding_required',
    );

    expect(
      malformedAdmissionManifestService.createBinding,
    ).toHaveBeenCalledTimes(1);

    expect(
      await executionStore.listByTask(task.id),
    ).toHaveLength(0);
  });

  it('queues work when the capability service is unavailable', async () => {
    const task = await createWorkingTask();
    const dispatcherWithoutCapability = new WorkerDispatcherService(
      supervisor,
      executionStore,
      undefined as never,
      new SupervisorAdmissionManifestService(),
    );

    const result = await dispatcherWithoutCapability.dispatch(
      task.id,
      'IMPLEMENTATION',
    );
    expect(result).toMatchObject({
      execution: { status: 'QUEUED' },
    });
    expect(result.capability).toBeUndefined();
    expect(await executionStore.listByTask(task.id)).toHaveLength(1);
  });

  it('queues independent verification without a verifier capability', async () => {
    const task = await createVerifyingTask();

    const result = await dispatcher.dispatch(
      task.id,
      'INDEPENDENT_VERIFICATION',
    );
    expect(result).toMatchObject({
      execution: {
        status: 'QUEUED',
        assignment: {
          executionPurpose: 'INDEPENDENT_VERIFICATION',
          workerCapability: undefined,
        },
      },
    });
    expect(result.capability).toBeUndefined();
    expect(await executionStore.listByTask(task.id)).toHaveLength(1);
  });

  it('requires VERIFYING before independent verification dispatch', async () => {
    const task = await createWorkingTask();

    await expect(
      dispatcher.dispatch(
        task.id,
        'INDEPENDENT_VERIFICATION',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'task_not_dispatchable',
        current: 'WORKING',
        required: 'VERIFYING',
      },
    });
  });

  it('requires WORKING before implementation dispatch', async () => {
    const task = await createVerifyingTask();

    await expect(
      dispatcher.dispatch(
        task.id,
        'IMPLEMENTATION',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'task_not_dispatchable',
        current: 'VERIFYING',
        required: 'WORKING',
      },
    });
  });

  it('uses read authority and mutation-deny scope for independent verification', async () => {
    const task = await createVerifyingTask();
    const permissionSpy = jest.spyOn(
      supervisor,
      'checkPermission',
    );

    const result = await dispatcher.dispatch(
      task.id,
      'INDEPENDENT_VERIFICATION',
    );

    expect(permissionSpy).toHaveBeenCalledWith(
      task.owner,
      'read_repo',
      { taskScopeIncludesAction: true },
    );
    expect(permissionSpy).not.toHaveBeenCalledWith(
      task.owner,
      'edit_assigned_files',
      expect.anything(),
    );
    expect(result.assignment.forbiddenActions).toEqual(
      expect.arrayContaining(
        VERIFIER_FORBIDDEN_ACTIONS,
      ),
    );
  });

  it('preserves edit authority for implementation dispatch', async () => {
    const task = await createWorkingTask();
    const permissionSpy = jest.spyOn(
      supervisor,
      'checkPermission',
    );

    await dispatcher.dispatch(
      task.id,
      'IMPLEMENTATION',
    );

    expect(permissionSpy).toHaveBeenCalledWith(
      task.owner,
      'edit_assigned_files',
      { taskScopeIncludesAction: true },
    );
  });

  it('rejects dispatch when task is not WORKING', async () => {
    const task = await supervisor.createTask({
      objective: 'Draft task',
      owner: 'backend',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: ['passes'],
    });

    await expect(dispatcher.dispatch(task.id, 'IMPLEMENTATION')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects dispatch when file ownership was lost', async () => {
    const task = await createWorkingTask();
    await fileStore.release(task.id);

    await expect(dispatcher.dispatch(task.id, 'IMPLEMENTATION')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a second active execution for the same task before persistence', async () => {
    const task = await createWorkingTask();
    await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    await expect(dispatcher.dispatch(task.id, 'IMPLEMENTATION')).rejects.toMatchObject({
      response: {
        code: 'active_execution_exists',
        taskId: task.id,
      },
    });
  });

  it('always includes protected integration actions in the assignment envelope', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(result.assignment.forbiddenActions).toEqual(
      expect.arrayContaining(PROTECTED_ACTIONS),
    );
  });

  it('creates a new execution for each retry after the previous execution is terminal', async () => {
    const task = await createWorkingTask();

    const first = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(first.execution.id);
    await dispatcher.markRunning(first.execution.id);
    await dispatcher.fail(first.execution.id, 'worker failed');
    const second = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(second.execution.id).not.toBe(first.execution.id);
    expect(await executionStore.listByTask(task.id)).toHaveLength(2);
  });

  it('generates different execution ids across fresh dispatcher instances', async () => {
    const task = await createWorkingTask();
    const first = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(first.execution.id);
    await dispatcher.markRunning(first.execution.id);
    await dispatcher.fail(first.execution.id, 'worker failed');

    const restartedDispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
      new SupervisorWorkerCapabilityService(capabilityAuthority()),
      new SupervisorAdmissionManifestService(),
    );
    const second = await restartedDispatcher.dispatch(task.id, 'IMPLEMENTATION');

    expect(second.execution.id).not.toBe(first.execution.id);
  });

  it('rejects malformed worker results with invalid_worker_result', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, {
        summary: 'Implemented',
      } as never),
    ).rejects.toMatchObject({
      response: { code: 'invalid_worker_result' },
    });
  });

  it('does not move the task to READY_FOR_REVIEW when execution completes', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);
    await dispatcher.complete(dispatched.execution.id, {
      summary: 'Implemented',
      evidence: {
        rootCause: 'Known cause',
        changedFiles: ['apps/api/src/example.ts'],
        tests: ['focused test PASS'],
        build: 'PASS',
        regression: ['adjacent PASS'],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'NO_INTEGRATION_PERFORMED',
        remainingRisk: [],
      },
    });

    expect((await supervisor.getTask(task.id)).status).toBe('WORKING');
  });

  it('allows DISPATCHED to transition to RUNNING', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);

    await expect(
      dispatcher.markRunning(dispatched.execution.id),
    ).resolves.toMatchObject({
      status: 'RUNNING',
    });
  });

  it('allows RUNNING to transition to COMPLETED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, workerResult()),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('allows RUNNING to transition to FAILED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.fail(dispatched.execution.id, 'worker failed'),
    ).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('preserves the existing legal DISPATCHED cancellation flow', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);

    await expect(
      dispatcher.cancel(dispatched.execution.id, 'owner stopped execution'),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('rejects DISPATCHED to COMPLETED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, workerResult()),
    ).rejects.toMatchObject({
      response: { code: 'invalid_execution_transition' },
    });
  });

  it('rejects terminal transition replays', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);
    await dispatcher.complete(dispatched.execution.id, workerResult());

    await expect(
      dispatcher.markRunning(dispatched.execution.id),
    ).rejects.toMatchObject({
      response: { code: 'invalid_execution_transition' },
    });
    await expect(
      dispatcher.complete(dispatched.execution.id, workerResult()),
    ).rejects.toMatchObject({
      response: { code: 'invalid_execution_transition' },
    });
  });

  it('rejects FAILED to COMPLETED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);
    await dispatcher.fail(dispatched.execution.id, 'worker failed');

    await expect(
      dispatcher.complete(dispatched.execution.id, workerResult()),
    ).rejects.toMatchObject({
      response: { code: 'invalid_execution_transition' },
    });
  });

  it('allows exactly one concurrent terminal transition', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id, 'IMPLEMENTATION');
    await moveQueuedToLegacyDispatched(dispatched.execution.id);
    await dispatcher.markRunning(dispatched.execution.id);

    const results = await Promise.allSettled([
      dispatcher.complete(dispatched.execution.id, workerResult()),
      dispatcher.fail(dispatched.execution.id, 'worker failed'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });
});

// R1_BOOTSTRAP_ADMISSION_RED_BEGIN
describe('R1 bootstrap server-side admission manifest', () => {
  it('uses only a server-produced authority binding and ignores caller-supplied binding', async () => {
    const { WorkerDispatcherService } =
      require('./worker-dispatcher.service');

    const serverBinding = {
      manifestHash: 'b'.repeat(64),
      claimEpoch: 0,
      leaseId: 'server-lease',
      runnerId: 'server-runner',
    };

    const clientSuppliedBinding = {
      manifestHash: 'a'.repeat(64),
      claimEpoch: 999,
      leaseId: 'client-lease',
      runnerId: 'client-runner',
    };

    const task = {
      id: 'ATLAS-TASK-RED',
      status: 'WORKING',
      owner: 'engineering',
      objective: 'R1 bootstrap admission remediation',
      allowedPaths: [
        'apps/api/src/agent-supervisor/dispatch/worker-dispatcher.service.ts',
      ],
      forbiddenActions: [],
      dependsOn: [],
      acceptance: [
        'authority binding is produced only by trusted server admission',
      ],
    };

    const supervisor = {
      getTask: jest.fn().mockResolvedValue(task),
      dependenciesReady: jest.fn().mockResolvedValue(true),
      ownsAllowedPaths: jest.fn().mockResolvedValue(true),
      checkPermission: jest.fn().mockReturnValue({
        allowed: true,
        reason: null,
      }),
    };

    const executionStore = {
      listByTask: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (execution: any) => execution),
      saveIfStatus: jest
        .fn()
        .mockImplementation(async (execution: any) => execution),
    };

    const capabilityService = {
      issue: jest.fn().mockImplementation((execution: any) => ({
        token: 'REDACTED_TEST_CAPABILITY',
        metadata: {
          version: 'test',
          assignmentDigest: 'test-digest',
          allowedActions: ['read_repo'],
          allowedPaths: [...execution.assignment.allowedPaths],
          forbiddenActions: [...execution.assignment.forbiddenActions],
          manifestHash: execution.assignment.manifestHash,
          claimEpoch: execution.assignment.claimEpoch,
          leaseId: execution.assignment.leaseId,
          runnerId: execution.assignment.runnerId,
          jti: 'test-jti',
          issuedAt: '2026-09-11T00:00:00.000Z',
          expiresAt: '2026-09-11T00:10:00.000Z',
        },
      })),
    };

    const admissionManifestService = {
      createBinding: jest.fn().mockReturnValue(serverBinding),
    };

    const dispatcher = new (WorkerDispatcherService as any)(
      supervisor,
      executionStore,
      capabilityService,
      admissionManifestService,
    );

    const result = await (dispatcher.dispatch as any)(
      'ATLAS-TASK-RED',
      'IMPLEMENTATION',
      clientSuppliedBinding,
    );

    expect(admissionManifestService.createBinding)
      .toHaveBeenCalledTimes(1);

    expect(
      admissionManifestService.createBinding.mock.calls[0][0],
    ).toEqual(
      expect.objectContaining({
        taskId: 'ATLAS-TASK-RED',
        workerRole: 'engineering',
        executionPurpose: 'IMPLEMENTATION',
        objective: 'R1 bootstrap admission remediation',
      }),
    );

    expect(result.assignment).toEqual(
      expect.objectContaining(serverBinding),
    );

    expect(result.assignment.manifestHash)
      .not.toBe(clientSuppliedBinding.manifestHash);

    expect(result.assignment.claimEpoch)
      .not.toBe(clientSuppliedBinding.claimEpoch);

    expect(result.assignment.leaseId)
      .not.toBe(clientSuppliedBinding.leaseId);

    expect(result.assignment.runnerId)
      .not.toBe(clientSuppliedBinding.runnerId);

    expect(capabilityService.issue).not.toHaveBeenCalled();
  });
});
// R1_BOOTSTRAP_ADMISSION_RED_END
