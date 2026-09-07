import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
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
    dispatcher = new WorkerDispatcherService(supervisor, executionStore);
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

  function syntheticResult(evidence: Record<string, unknown> = {}) {
    return {
      summary: 'Validated synthetic runner claim plane',
      evidence: {
        rootCause: 'synthetic_runner_claim_plane_validation',
        changedFiles: [],
        tests: ['claim plane smoke PASS'],
        build: 'NOT_RUN_SYNTHETIC',
        regression: ['parent task unchanged PASS'],
        deploymentState: 'NONE',
        gitState: 'UNCHANGED',
        remainingRisk: [],
        ...evidence,
      },
    };
  }

  it('dispatches a WORKING task with owned files and a restart-safe execution id', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id);

    expect(result.execution.status).toBe('DISPATCHED');
    expect(result.execution.id).toMatch(
      /^ATLAS-EXEC-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.assignment.taskId).toBe(task.id);
    expect(result.assignment.workerRole).toBe('backend');
    expect(result.assignment.allowedPaths).toEqual(task.allowedPaths);
    expect(result.assignment.runnerEligibility).toBe('STANDARD');
    expect(result.execution).toMatchObject({
      claimedBy: null,
      claimEpoch: 0,
      claimedAt: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
    });
  });

  it('records IMPLEMENTATION as the default execution purpose', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id);

    expect(
      (result.assignment as { executionPurpose?: string }).executionPurpose,
    ).toBe('IMPLEMENTATION');
  });

  it('does not issue a worker capability before a runner claims the execution', async () => {
    const task = await createWorkingTask();
    const capabilityService = new SupervisorWorkerCapabilityService({
      get: (name: string) =>
        name === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? 'owner-secret' : undefined,
    } as never);
    const capabilityDispatcher = Reflect.construct(WorkerDispatcherService, [
      supervisor,
      executionStore,
      capabilityService,
    ]) as WorkerDispatcherService;

    const result = await capabilityDispatcher.dispatch(task.id);
    expect(result).not.toHaveProperty('capability');
    expect(result.assignment.workerCapability).toBeUndefined();
    expect((await executionStore.get(result.execution.id))?.assignment).toEqual(
      result.assignment,
    );
  });

  it('records explicit A1 synthetic runner eligibility', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(
      task.id,
      'IMPLEMENTATION',
      'A1_SYNTHETIC',
    );

    expect(result.assignment.runnerEligibility).toBe('A1_SYNTHETIC');
  });

  it('rejects A1 synthetic independent verification executions', async () => {
    const task = await createWorkingTask();

    await expect(
      dispatcher.dispatch(
        task.id,
        'INDEPENDENT_VERIFICATION',
        'A1_SYNTHETIC',
      ),
    ).rejects.toMatchObject({
      response: { code: 'runner_execution_not_eligible' },
    });
    expect(await executionStore.listByTask(task.id)).toEqual([]);
  });

  it('can dispatch a separately bound independent verification execution', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(
      task.id,
      'INDEPENDENT_VERIFICATION',
    );

    expect(result.assignment.executionPurpose).toBe('INDEPENDENT_VERIFICATION');
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

    await expect(dispatcher.dispatch(task.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects dispatch when file ownership was lost', async () => {
    const task = await createWorkingTask();
    await fileStore.release(task.id);

    await expect(dispatcher.dispatch(task.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a second active execution for the same task before persistence', async () => {
    const task = await createWorkingTask();
    await dispatcher.dispatch(task.id);

    await expect(dispatcher.dispatch(task.id)).rejects.toMatchObject({
      response: {
        code: 'active_execution_exists',
        taskId: task.id,
      },
    });
  });

  it('always includes protected integration actions in the assignment envelope', async () => {
    const task = await createWorkingTask();

    const result = await dispatcher.dispatch(task.id);

    expect(result.assignment.forbiddenActions).toEqual(
      expect.arrayContaining(PROTECTED_ACTIONS),
    );
  });

  it('creates a new execution for each retry after the previous execution is terminal', async () => {
    const task = await createWorkingTask();

    const first = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(first.execution.id);
    await dispatcher.fail(first.execution.id, 'worker failed');
    const second = await dispatcher.dispatch(task.id);

    expect(second.execution.id).not.toBe(first.execution.id);
    expect(await executionStore.listByTask(task.id)).toHaveLength(2);
  });

  it('generates different execution ids across fresh dispatcher instances', async () => {
    const task = await createWorkingTask();
    const first = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(first.execution.id);
    await dispatcher.fail(first.execution.id, 'worker failed');

    const restartedDispatcher = new WorkerDispatcherService(
      supervisor,
      executionStore,
    );
    const second = await restartedDispatcher.dispatch(task.id);

    expect(second.execution.id).not.toBe(first.execution.id);
  });

  it('rejects malformed worker results with invalid_worker_result', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);
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
    const dispatched = await dispatcher.dispatch(task.id);
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

  it('completes an A1 synthetic execution with exact no-op evidence without mutating its parent task', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(
      task.id,
      'IMPLEMENTATION',
      'A1_SYNTHETIC',
    );
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, syntheticResult() as never),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      result: syntheticResult(),
    });
    expect((await supervisor.getTask(task.id)).status).toBe('WORKING');
  });

  it.each([
    ['rootCause', { rootCause: 'not_the_synthetic_contract' }],
    ['changedFiles', { changedFiles: ['apps/api/src/example.ts'] }],
    ['build', { build: 'PASS' }],
    ['deploymentState', { deploymentState: 'NOT_DEPLOYED' }],
    ['gitState', { gitState: 'NO_INTEGRATION_PERFORMED' }],
    ['reviewCandidate', { reviewCandidate: {} }],
    ['ownerMergeAuthorization', { ownerMergeAuthorization: {} }],
    [
      'ownerMergeAuthorizationConsumption',
      { ownerMergeAuthorizationConsumption: {} },
    ],
    ['ownerDeploymentAuthorization', { ownerDeploymentAuthorization: {} }],
    [
      'ownerDeploymentAuthorizationRevocations',
      { ownerDeploymentAuthorizationRevocations: [] },
    ],
  ])(
    'rejects synthetic completion evidence violating %s before persisting completion',
    async (_field, evidence) => {
      const task = await createWorkingTask();
      const dispatched = await dispatcher.dispatch(
        task.id,
        'IMPLEMENTATION',
        'A1_SYNTHETIC',
      );
      await dispatcher.markRunning(dispatched.execution.id);

      await expect(
        dispatcher.complete(
          dispatched.execution.id,
          syntheticResult(evidence) as never,
        ),
      ).rejects.toMatchObject({
        response: { code: 'synthetic_execution_evidence_violation' },
      });
      await expect(
        dispatcher.getExecution(dispatched.execution.id),
      ).resolves.toMatchObject({ status: 'RUNNING', result: null });
    },
  );

  it('allows DISPATCHED to transition to RUNNING', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);

    await expect(
      dispatcher.markRunning(dispatched.execution.id),
    ).resolves.toMatchObject({
      status: 'RUNNING',
    });
  });

  it('allows RUNNING to transition to COMPLETED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, workerResult()),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('allows RUNNING to transition to FAILED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);
    await dispatcher.markRunning(dispatched.execution.id);

    await expect(
      dispatcher.fail(dispatched.execution.id, 'worker failed'),
    ).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('preserves the existing legal DISPATCHED cancellation flow', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);

    await expect(
      dispatcher.cancel(dispatched.execution.id, 'owner stopped execution'),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('rejects DISPATCHED to COMPLETED', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);

    await expect(
      dispatcher.complete(dispatched.execution.id, workerResult()),
    ).rejects.toMatchObject({
      response: { code: 'invalid_execution_transition' },
    });
  });

  it('rejects terminal transition replays', async () => {
    const task = await createWorkingTask();
    const dispatched = await dispatcher.dispatch(task.id);
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
    const dispatched = await dispatcher.dispatch(task.id);
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
    const dispatched = await dispatcher.dispatch(task.id);
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
