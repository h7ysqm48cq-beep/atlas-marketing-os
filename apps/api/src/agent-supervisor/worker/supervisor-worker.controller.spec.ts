import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import type { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import {
  SUPERVISOR_WORKER_OPERATION,
  SupervisorWorkerGuard,
} from './supervisor-worker.guard';
import { SupervisorWorkerController } from './supervisor-worker.controller';
import { resolveSupervisorExecutionLivenessConfig } from '../execution/supervisor-execution-liveness.config';

describe('SupervisorWorkerController', () => {
  const assignment = {
    executionId: 'ATLAS-EXEC-1',
    taskId: 'ATLAS-1',
    workerRole: 'engineering' as const,
    objective: 'Worker capability plane',
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
    status: 'DISPATCHED' as const,
    assignment,
    result: null,
    error: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };

  function setup() {
    const getExecution = jest.fn().mockResolvedValue(execution);
    const markRunning = jest.fn().mockResolvedValue(execution);
    const complete = jest.fn().mockResolvedValue(execution);
    const fail = jest.fn().mockResolvedValue(execution);
    const cancel = jest.fn().mockResolvedValue(execution);
    const heartbeat = jest.fn().mockResolvedValue(execution);
    const dispatcher = {
      getExecution,
      markRunning,
      complete,
      fail,
      cancel,
    } as unknown as jest.Mocked<WorkerDispatcherService>;
    const heartbeatStore = { heartbeat };
    const Controller = SupervisorWorkerController as unknown as new (
      ...args: unknown[]
    ) => SupervisorWorkerController;
    return {
      controller: new Controller(
        dispatcher,
        heartbeatStore,
        resolveSupervisorExecutionLivenessConfig(),
      ),
      calls: { getExecution, markRunning, complete, fail, cancel, heartbeat },
    };
  }

  function heartbeatMethod(controller: object) {
    return (controller as Record<string, unknown>).heartbeat as
      | ((...args: unknown[]) => unknown)
      | undefined;
  }

  it('protects every route with the worker capability guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SupervisorWorkerController)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupervisorWorkerController),
    ).toEqual([SupervisorWorkerGuard]);
  });

  it('returns only the capability-bound assignment', async () => {
    const { controller, calls } = setup();

    await expect(
      controller.getAssignment(assignment.taskId, assignment.executionId),
    ).resolves.toEqual(assignment);
    expect(calls.getExecution).toHaveBeenCalledWith(assignment.executionId);
  });

  it('delegates worker lifecycle mutations to the dispatcher', async () => {
    const { controller, calls } = setup();
    const result = { summary: 'done', evidence: {} } as never;

    await controller.markRunning(assignment.taskId, assignment.executionId);
    await controller.complete(
      assignment.taskId,
      assignment.executionId,
      result,
    );
    await controller.fail(assignment.taskId, assignment.executionId, {
      error: 'failed',
    });
    await controller.cancel(assignment.taskId, assignment.executionId, {
      reason: 'cancelled',
    });

    expect(calls.markRunning).toHaveBeenCalledWith(assignment.executionId);
    expect(calls.complete).toHaveBeenCalledWith(assignment.executionId, result);
    expect(calls.fail).toHaveBeenCalledWith(assignment.executionId, 'failed');
    expect(calls.cancel).toHaveBeenCalledWith(
      assignment.executionId,
      'cancelled',
    );
  });

  it('does not expose owner approval or integration authority', () => {
    const { controller } = setup();
    const surface = controller as unknown as Record<string, unknown>;

    expect(surface.approveTask).toBeUndefined();
    expect(surface.authorizeMerge).toBeUndefined();
    expect(surface.authorizeProductionDeployment).toBeUndefined();
  });

  it('declares the exact guarded heartbeat route and operation metadata', () => {
    const method = heartbeatMethod(setup().controller);

    expect(method).toEqual(expect.any(Function));
    if (!method) return;

    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      'tasks/:taskId/executions/:executionId/heartbeat',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(1);
    expect(Reflect.getMetadata(SUPERVISOR_WORKER_OPERATION, method)).toBe(
      'heartbeat',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupervisorWorkerController),
    ).toEqual([SupervisorWorkerGuard]);
  });

  it('uses only guard-authenticated claim binding and ignores caller binding fields', async () => {
    const { controller, calls } = setup();
    const method = heartbeatMethod(controller);
    expect(method).toEqual(expect.any(Function));
    if (!method) return;

    const authorization = {
      taskId: assignment.taskId,
      executionId: assignment.executionId,
      workerRole: assignment.workerRole,
      claimEpoch: 4,
      runnerId: 'runner-4',
      leaseId: 'lease-4',
    };
    await method(
      { supervisorWorkerAuthorization: authorization },
      assignment.taskId,
      assignment.executionId,
      {
        claimEpoch: 999,
        runnerId: 'attacker-runner',
        leaseId: 'attacker-lease',
        leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      },
    );

    expect(calls.heartbeat).toHaveBeenCalledTimes(1);
    expect(calls.heartbeat.mock.calls[0][0]).toMatchObject(authorization);
    expect(calls.heartbeat.mock.calls[0][0]).not.toMatchObject({
      claimEpoch: 999,
      runnerId: 'attacker-runner',
      leaseId: 'attacker-lease',
    });
  });

  it('derives heartbeat time and lease expiry from the server and liveness config', async () => {
    const { controller, calls } = setup();
    const method = heartbeatMethod(controller);
    expect(method).toEqual(expect.any(Function));
    if (!method) return;

    const now = new Date('2026-09-06T00:00:00.000Z');
    const config = resolveSupervisorExecutionLivenessConfig();
    jest.useFakeTimers().setSystemTime(now);

    try {
      await method(
        {
          supervisorWorkerAuthorization: {
            taskId: assignment.taskId,
            executionId: assignment.executionId,
            workerRole: assignment.workerRole,
            claimEpoch: 4,
            runnerId: 'runner-4',
            leaseId: 'lease-4',
          },
        },
        assignment.taskId,
        assignment.executionId,
        {
          now: new Date('2099-01-01T00:00:00.000Z'),
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      );
    } finally {
      jest.useRealTimers();
    }

    expect(calls.heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        now,
        leaseExpiresAt: new Date(now.getTime() + config.runningLeaseMs),
      }),
    );
  });

  it('fails closed when the heartbeat store rejects the renewal', async () => {
    const { controller, calls } = setup();
    const method = heartbeatMethod(controller);
    expect(method).toEqual(expect.any(Function));
    if (!method) return;
    calls.heartbeat.mockResolvedValue(null);

    await expect(
      method(
        { supervisorWorkerAuthorization: assignment },
        assignment.taskId,
        assignment.executionId,
        {},
      ),
    ).rejects.toBeDefined();
    expect(calls.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('returns the authoritative renewed execution without issuing a new capability', async () => {
    const { controller, calls } = setup();
    const method = heartbeatMethod(controller);
    expect(method).toEqual(expect.any(Function));
    if (!method) return;
    const renewed = {
      ...execution,
      status: 'RUNNING' as const,
      claimEpoch: 4,
      runnerId: 'runner-4',
      lastHeartbeatAt: new Date('2026-09-06T00:00:00.000Z'),
      leaseExpiresAt: new Date('2026-09-06T00:01:00.000Z'),
    };
    calls.heartbeat.mockResolvedValue(renewed);

    await expect(
      method(
        { supervisorWorkerAuthorization: assignment },
        assignment.taskId,
        assignment.executionId,
        {},
      ),
    ).resolves.toBe(renewed);
  });

  it('keeps heartbeat separate from Owner, merge, and deployment authority', () => {
    const surface = setup().controller as unknown as Record<string, unknown>;

    expect(surface.heartbeat).toEqual(expect.any(Function));
    expect(surface.approveTask).toBeUndefined();
    expect(surface.authorizeMerge).toBeUndefined();
    expect(surface.authorizeProductionDeployment).toBeUndefined();
    expect(surface.runMigration).toBeUndefined();
    expect(surface.changeRuntimeConfig).toBeUndefined();
  });
});
