import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { resolveSupervisorExecutionLivenessConfig } from '../execution/supervisor-execution-liveness.config';

function loadVerifierControllerModule(): any {
  try {
    return require('./supervisor-verifier.controller');
  } catch {
    return {};
  }
}

function loadVerifierGuardModule(): any {
  try {
    return require('./supervisor-verifier.guard');
  } catch {
    return {};
  }
}

describe('SupervisorVerifierController RED contract', () => {
  const assignment = {
    executionId: 'ATLAS-EXEC-VERIFIER-1',
    taskId: 'ATLAS-VERIFIER-1',
    workerRole: 'engineering' as const,
    executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
    manifestHash: 'a'.repeat(64),
    claimEpoch: 4,
    leaseId: 'lease-verifier-4',
    runnerId: 'runner-verifier-4',
    objective: 'Verify Engineering Runner integration',
    allowedPaths: ['apps/api/src/example.ts'],
    forbiddenActions: [],
    dependencies: [],
    acceptance: [],
    requiredEvidence: [],
  };

  const execution = {
    id: assignment.executionId,
    taskId: assignment.taskId,
    workerRole: assignment.workerRole,
    status: 'RUNNING' as const,
    assignment,
    result: null,
    error: null,
    createdAt: new Date('2026-09-14T09:00:00.000Z'),
    startedAt: new Date('2026-09-14T09:00:01.000Z'),
    completedAt: null,
    runnerId: assignment.runnerId,
    claimEpoch: assignment.claimEpoch,
    lastHeartbeatAt: new Date('2026-09-14T09:00:02.000Z'),
    leaseExpiresAt: new Date('2026-09-14T09:01:02.000Z'),
  };

  function setup() {
    const controllerModule = loadVerifierControllerModule();
    const guardModule = loadVerifierGuardModule();
    const Controller = controllerModule.SupervisorVerifierController;
    const Guard = guardModule.SupervisorVerifierGuard;
    const operationKey = guardModule.SUPERVISOR_VERIFIER_OPERATION;

    expect(Controller).toBeDefined();
    expect(Guard).toBeDefined();
    expect(operationKey).toBeDefined();
    if (!Controller || !Guard || !operationKey) return undefined;

    const getExecution = jest.fn().mockResolvedValue(execution);
    const complete = jest.fn().mockResolvedValue(execution);
    const fail = jest.fn().mockResolvedValue(execution);
    const cancel = jest.fn().mockResolvedValue(execution);
    const heartbeat = jest.fn().mockResolvedValue(execution);

    const controller = new Controller(
      { getExecution, complete, fail, cancel },
      { heartbeat },
    );

    return {
      Controller,
      Guard,
      operationKey,
      controller,
      calls: { getExecution, complete, fail, cancel, heartbeat },
    };
  }

  it('is a public verifier-only capability surface', () => {
    const setupValue = setup();
    if (!setupValue) return;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, setupValue.Controller)).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, setupValue.Controller)).toBe(
      'engineering/supervisor/verifier',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, setupValue.Controller)).toEqual([
      setupValue.Guard,
    ]);
  });

  it('exposes assignment, verification submission, failure, cancel, and heartbeat only', () => {
    const setupValue = setup();
    if (!setupValue) return;
    const surface = setupValue.controller as Record<string, unknown>;

    expect(surface.getAssignment).toEqual(expect.any(Function));
    expect(surface.submitVerification).toEqual(expect.any(Function));
    expect(surface.fail).toEqual(expect.any(Function));
    expect(surface.cancel).toEqual(expect.any(Function));
    expect(surface.heartbeat).toEqual(expect.any(Function));
    expect(surface.approveTask).toBeUndefined();
    expect(surface.authorizeMerge).toBeUndefined();
    expect(surface.authorizeProductionDeployment).toBeUndefined();
  });

  it('declares exact verifier operation metadata for submit and heartbeat', () => {
    const setupValue = setup();
    if (!setupValue) return;

    const submit = setupValue.Controller.prototype.submitVerification;
    const heartbeat = setupValue.Controller.prototype.heartbeat;

    expect(Reflect.getMetadata(PATH_METADATA, submit)).toBe(
      'tasks/:taskId/executions/:executionId/verification',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, submit)).toBe(1);
    expect(Reflect.getMetadata(setupValue.operationKey, submit)).toBe(
      'submit_verification',
    );

    expect(Reflect.getMetadata(PATH_METADATA, heartbeat)).toBe(
      'tasks/:taskId/executions/:executionId/heartbeat',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, heartbeat)).toBe(1);
    expect(Reflect.getMetadata(setupValue.operationKey, heartbeat)).toBe(
      'heartbeat',
    );
  });

  it('delegates verification evidence to the existing execution dispatcher', async () => {
    const setupValue = setup();
    if (!setupValue) return;
    const result = {
      summary: 'independent verification pass',
      evidence: {
        rootCause: 'verified',
        changedFiles: [],
        tests: ['PASS'],
        build: 'PASS',
        regression: [],
        deploymentState: 'NOT_DEPLOYED',
        gitState: 'CLEAN',
        remainingRisk: [],
      },
    };

    await setupValue.controller.submitVerification(
      assignment.taskId,
      assignment.executionId,
      result,
    );

    expect(setupValue.calls.complete).toHaveBeenCalledWith(
      assignment.executionId,
      result,
    );
  });

  it('renews heartbeat only from guard-authenticated claim binding and server time', async () => {
    const setupValue = setup();
    if (!setupValue) return;
    const now = new Date('2026-09-14T09:10:00.000Z');
    const config = resolveSupervisorExecutionLivenessConfig();
    jest.useFakeTimers().setSystemTime(now);

    try {
      await setupValue.controller.heartbeat(
        {
          supervisorVerifierAuthorization: {
            taskId: assignment.taskId,
            executionId: assignment.executionId,
            workerRole: assignment.workerRole,
            claimEpoch: assignment.claimEpoch,
            runnerId: assignment.runnerId,
            leaseId: assignment.leaseId,
          },
        },
        assignment.taskId,
        assignment.executionId,
        {
          claimEpoch: 999,
          runnerId: 'attacker',
          leaseId: 'attacker',
        },
      );
    } finally {
      jest.useRealTimers();
    }

    expect(setupValue.calls.heartbeat).toHaveBeenCalledWith({
      executionId: assignment.executionId,
      taskId: assignment.taskId,
      workerRole: assignment.workerRole,
      claimEpoch: assignment.claimEpoch,
      runnerId: assignment.runnerId,
      leaseId: assignment.leaseId,
      now,
      leaseExpiresAt: new Date(now.getTime() + config.runningLeaseMs),
    });
  });
});
