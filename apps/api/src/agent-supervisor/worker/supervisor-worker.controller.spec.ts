import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import type { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { SupervisorWorkerGuard } from './supervisor-worker.guard';
import { SupervisorWorkerController } from './supervisor-worker.controller';

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
    const dispatcher = {
      getExecution,
      markRunning,
      complete,
      fail,
      cancel,
    } as unknown as jest.Mocked<WorkerDispatcherService>;
    return {
      controller: new SupervisorWorkerController(dispatcher),
      calls: { getExecution, markRunning, complete, fail, cancel },
    };
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
});
