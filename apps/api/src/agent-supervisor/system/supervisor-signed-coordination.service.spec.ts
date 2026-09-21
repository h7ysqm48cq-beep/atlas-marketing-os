import { ConfigService } from '@nestjs/config';
import { SupervisorSignedCoordinationService } from
  './supervisor-signed-coordination.service';

const TASK = 'ATLAS-SYS-140';
const IMPL = 'ATLAS-EXEC-140-IMPL';
const VERIFIER = 'ATLAS-EXEC-140-VERIFIER';
const flags = {
  ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE: 'required',
  ATLAS_SUPERVISOR_SIGNED_COORDINATION_MODE: 'enabled',
};
function harness(status: string, executions: Array<{
  id: string; status: string; assignment: {
    executionPurpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';
  };
}> = []) {
  const task = { id: TASK, status, updatedAt: new Date(
    '2026-09-22T00:00:00.000Z') };
  const supervisor = {
    getTask: jest.fn().mockResolvedValue(task),
    listTasks: jest.fn().mockResolvedValue([task]),
    beginVerification: jest.fn().mockResolvedValue({
      ...task, status: 'VERIFYING',
    }),
  };
  const gateway = {
    submitImplementationFromExecution: jest.fn().mockResolvedValue({
      ...task, status: 'IMPLEMENTED',
    }),
  };
  const dispatcher = {
    listByTask: jest.fn().mockResolvedValue(executions),
    dispatch: jest.fn().mockResolvedValue({
      execution: { id: VERIFIER },
    }),
  };
  const signed = {
    assertCompletedImplementation: jest.fn().mockResolvedValue(undefined),
    currentTaskVersion: jest.fn().mockResolvedValue(
      '2026-09-22T00:00:00.000Z'),
    releaseReady: jest.fn().mockResolvedValue({
      ...task, status: 'READY_FOR_REVIEW',
    }),
  };
  const config = { get: (key: string) =>
    flags[key as keyof typeof flags] };
  const service = new SupervisorSignedCoordinationService(
    supervisor as never, gateway as never,
    dispatcher as never, signed as never,
    config as ConfigService,
  );
  return { task, supervisor, gateway, dispatcher, signed, service };
}
function execution(id: string, status: string,
  purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION') {
  return { id, status, assignment: {
    executionPurpose: purpose,
  } };
}
const complete = execution(IMPL, 'COMPLETED', 'IMPLEMENTATION');
const verified = execution(VERIFIER, 'COMPLETED',
  'INDEPENDENT_VERIFICATION');

describe('Issue #140 signed control-plane coordination', () => {
  it('completed implementation requires DB-ledger proof check BEFORE submit', async () => {
    const h = harness('WORKING', [complete]);
    expect(await h.service.advanceTask(TASK)).toEqual({
      taskId: TASK, action: 'IMPLEMENTATION_SUBMITTED',
      executionId: IMPL,
    });
    expect(h.signed.assertCompletedImplementation)
      .toHaveBeenCalledWith({ taskId: TASK, executionId: IMPL });
    expect(h.gateway.submitImplementationFromExecution)
      .toHaveBeenCalledWith(TASK, IMPL);
    expect(h.signed.assertCompletedImplementation.mock.invocationCallOrder[0])
      .toBeLessThan(
        h.gateway.submitImplementationFromExecution.mock.invocationCallOrder[0]);
    expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(h.signed.releaseReady).not.toHaveBeenCalled();
  });
  it('forged or absent proof cannot submit task evidence', async () => {
    const h = harness('WORKING', [complete]);
    h.signed.assertCompletedImplementation.mockRejectedValue(
      new Error('missing_or_forged_ledger'),
    );
    await expect(h.service.advanceTask(TASK))
      .rejects.toThrow('missing_or_forged_ledger');
    expect(h.gateway.submitImplementationFromExecution)
      .not.toHaveBeenCalled();
    expect(h.supervisor.beginVerification).not.toHaveBeenCalled();
  });
  it('active implementation never triggers premature transition', async () => {
    const h = harness('WORKING', [
      execution(IMPL, 'RUNNING', 'IMPLEMENTATION'),
    ]);
    expect((await h.service.advanceTask(TASK)).action).toBe('IDLE');
    expect(h.signed.assertCompletedImplementation).not.toHaveBeenCalled();
  });
  it('IMPLEMENTED begins verification without dispatching in same step', async () => {
    const h = harness('IMPLEMENTED', [complete]);
    expect((await h.service.advanceTask(TASK)).action)
      .toBe('VERIFICATION_STARTED');
    expect(h.supervisor.beginVerification).toHaveBeenCalledWith(TASK);
    expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
  });
  it('VERIFYING queues only one independent verifier', async () => {
    const h = harness('VERIFYING', [complete]);
    expect(await h.service.advanceTask(TASK)).toEqual({
      taskId: TASK, action: 'VERIFIER_QUEUED',
      executionId: VERIFIER,
    });
    expect(h.dispatcher.dispatch).toHaveBeenCalledWith(
      TASK, 'INDEPENDENT_VERIFICATION',
    );
  });
  it('active verifier prevents replacement or premature READY', async () => {
    const h = harness('VERIFYING', [complete,
      execution(VERIFIER, 'RUNNING', 'INDEPENDENT_VERIFICATION'),
    ]);
    expect((await h.service.advanceTask(TASK)).action).toBe('IDLE');
    expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(h.signed.releaseReady).not.toHaveBeenCalled();
  });
  it('verifier failure blocks retry and READY', async () => {
    const h = harness('VERIFYING', [complete,
      execution(VERIFIER, 'FAILED', 'INDEPENDENT_VERIFICATION'),
    ]);
    expect((await h.service.advanceTask(TASK)).action).toBe('BLOCKED');
    expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(h.signed.releaseReady).not.toHaveBeenCalled();
  });
  it('completed verifier releases READY only through DB proof gate', async () => {
    const h = harness('VERIFYING', [complete, verified]);
    expect(await h.service.advanceTask(TASK)).toEqual({
      taskId: TASK, action: 'READY_FOR_REVIEW',
      executionId: VERIFIER,
    });
    expect(h.signed.currentTaskVersion).toHaveBeenCalledWith(TASK);
    expect(h.signed.releaseReady).toHaveBeenCalledWith({
      taskId: TASK, expectedTaskVersion:
        '2026-09-22T00:00:00.000Z',
    });
    expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
  });
  it('READY proof failure cannot be misreported as success', async () => {
    const h = harness('VERIFYING', [complete, verified]);
    h.signed.releaseReady.mockRejectedValue(new Error('no_real_verifier'));
    await expect(h.service.advanceTask(TASK))
      .rejects.toThrow('no_real_verifier');
    expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
  });
  it('does not process any task unless BOTH mode flags enabled', async () => {
    const h = harness('WORKING', [complete]);
    const denied = new SupervisorSignedCoordinationService(
      h.supervisor as never, h.gateway as never,
      h.dispatcher as never, h.signed as never,
      { get: (key: string) => key ===
        'ATLAS_SUPERVISOR_SIGNED_COORDINATION_MODE'
        ? 'enabled' : undefined } as never,
    );
    await expect(denied.advanceTask(TASK))
      .rejects.toThrow('signed_coordination_not_enabled');
    expect(await denied.tickNow()).toEqual([]);
    await denied.onModuleInit();
    denied.onModuleDestroy();
    expect(h.supervisor.getTask).not.toHaveBeenCalled();
    expect(h.supervisor.listTasks).not.toHaveBeenCalled();
  });
  it('same-task concurrent call rejects, never double-dispatches', async () => {
    const h = harness('VERIFYING', [complete]);
    let resolveDispatch!: (value: unknown) => void;
    h.dispatcher.dispatch.mockImplementation(() => new Promise(
      resolve => { resolveDispatch = resolve; },
    ));
    const pending = h.service.advanceTask(TASK);
    await Promise.resolve();
    await Promise.resolve();
    await expect(h.service.advanceTask(TASK))
      .rejects.toThrow('signed_coordination_already_running');
    resolveDispatch({ execution: { id: VERIFIER } });
    expect((await pending).action).toBe('VERIFIER_QUEUED');
    expect(h.dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
  it('terminal history never starves an active task after first 50 rows', async () => {
    const h = harness('WORKING', [complete]);
    h.supervisor.listTasks.mockResolvedValue([
      ...Array.from({ length: 65 }, (_, n) => ({
        id: 'DONE-' + n, status: 'READY_FOR_REVIEW',
      })),
      h.task,
    ]);
    expect(await h.service.tickNow()).toEqual([{
      taskId: TASK, action: 'IMPLEMENTATION_SUBMITTED',
      executionId: IMPL,
    }]);
    expect(h.gateway.submitImplementationFromExecution)
      .toHaveBeenCalledTimes(1);
  });

  it('round-robin reaches active tasks beyond 50 blocked/active rows', async () => {
    const h = harness('WORKING', [complete]);
    h.supervisor.listTasks.mockResolvedValue([
      ...Array.from({ length: 60 }, (_, n) => ({
        id: 'ACTIVE-' + n, status: 'WORKING',
      })), h.task,
    ]);
    expect((await h.service.tickNow()).some(row =>
      row.taskId === TASK)).toBe(false);
    expect((await h.service.tickNow()).some(row =>
      row.taskId === TASK &&
      row.action === 'IMPLEMENTATION_SUBMITTED')).toBe(true);
  });

  it('production bounded query fetches only active IDs, paginates and never loads all tasks', async () => {
    const h = harness('WORKING', [complete]);
    const db = { $queryRawUnsafe: jest.fn()
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, n) => ({
        id: 'PAGE1-' + n,
      })))
      .mockResolvedValueOnce([{ id: TASK }]),
    };
    const coordinator = new SupervisorSignedCoordinationService(
      h.supervisor as never, h.gateway as never,
      h.dispatcher as never, h.signed as never,
      { get: (key: string) =>
        flags[key as keyof typeof flags] } as never,
      db as never,
    );
    expect(await coordinator.tickNow()).toHaveLength(50);
    expect(await coordinator.tickNow()).toEqual([{
      taskId: TASK, action: 'IMPLEMENTATION_SUBMITTED',
      executionId: IMPL,
    }]);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(db.$queryRawUnsafe.mock.calls[0][0])
      .toMatch(/status.*WORKING.*IMPLEMENTED.*VERIFYING.*LIMIT 50 OFFSET/);
    expect(db.$queryRawUnsafe.mock.calls[0][1]).toBe(0);
    expect(db.$queryRawUnsafe.mock.calls[1][1]).toBe(50);
    expect(h.supervisor.listTasks).not.toHaveBeenCalled();
  });

  it('automated scan stops at one durable step per task', async () => {
    const h = harness('WORKING', [complete]);
    expect(await h.service.tickNow()).toEqual([{
      taskId: TASK, action: 'IMPLEMENTATION_SUBMITTED',
      executionId: IMPL,
    }]);
    expect(h.gateway.submitImplementationFromExecution)
      .toHaveBeenCalledTimes(1);
    expect(h.supervisor.beginVerification).not.toHaveBeenCalled();
  });
});
