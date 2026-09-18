import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { SupervisorWorkerGuard } from './supervisor-worker.guard';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';

function loadBootstrapController(): any {
  try {
    return require('./supervisor-worker-bootstrap.controller')
      .SupervisorWorkerBootstrapController;
  } catch {
    return undefined;
  }
}

function loadBootstrapGuard(): any {
  try {
    return require('./supervisor-worker-bootstrap.guard')
      .SupervisorWorkerBootstrapGuard;
  } catch {
    return undefined;
  }
}

function execution(
  purpose: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION' = 'IMPLEMENTATION',
): SupervisorExecution {
  const id = 'ATLAS-EXEC-S4B-1';
  const taskId = 'ATLAS-S4B-1';
  return {
    id,
    taskId,
    workerRole: 'backend',
    status: 'RUNNING',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'backend',
      executionPurpose: purpose,
      manifestHash: 'a'.repeat(64),
      claimEpoch: 1,
      leaseId: 'lease-s4b-1',
      runnerId: 'runner-s4b-1',
      objective: 'S4B bootstrap claim transport',
      allowedPaths: ['apps/api/src/agent-supervisor/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependencies: [],
      acceptance: ['claimed'],
      requiredEvidence: [],
    },
    result: null,
    error: null,
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    startedAt: new Date('2026-09-12T00:01:00.000Z'),
    completedAt: null,
    runnerId: 'runner-s4b-1',
    claimEpoch: 1,
    lastHeartbeatAt: new Date('2026-09-12T00:01:00.000Z'),
    leaseExpiresAt: new Date('2026-09-12T00:06:00.000Z'),
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    supervisorWorkerBootstrapRole: 'backend',
    body: {},
    ...overrides,
  };
}

function setup(claimed: SupervisorExecution | null = execution()) {
  const claimNext = jest.fn().mockResolvedValue(claimed);
  const issueWorker = jest.fn().mockReturnValue({
    token: 'opaque-worker-capability-token',
    metadata: {
      version: 2,
      assignmentDigest: 'b'.repeat(64),
      allowedActions: ['read_assignment'],
      manifestHash: claimed?.assignment.manifestHash,
      allowedPaths: claimed?.assignment.allowedPaths,
      forbiddenActions: claimed?.assignment.forbiddenActions,
      claimEpoch: claimed?.claimEpoch,
      leaseId: claimed?.assignment.leaseId,
      runnerId: claimed?.assignment.runnerId,
      jti: 'jti-s4b-1',
      issuedAt: '2026-09-12T00:01:00.000Z',
      expiresAt: '2026-09-12T00:06:00.000Z',
    },
  });
  const issueVerifier = jest
    .fn()
    .mockReturnValue('opaque-verifier-capability-token');
  const saveIfStatus = jest.fn().mockResolvedValue(claimed);
  const Target = loadBootstrapController();
  expect(Target).toBeDefined();
  if (!Target) return undefined;
  return {
    controller: new Target(
      { claimNext },
      { issue: issueWorker },
      { issue: issueVerifier },
      { saveIfStatus },
    ),
    calls: { claimNext, issueWorker, issueVerifier, saveIfStatus },
  };
}

function invoke(controller: any, value = request(), body = {}) {
  return controller.claimNext(value, body);
}

describe('SupervisorWorkerBootstrapController RED contract', () => {
  it('is public, uses only the bootstrap guard, and exposes claim-next', () => {
    const Target = loadBootstrapController();
    const BootstrapGuard = loadBootstrapGuard();
    expect(Target).toBeDefined();
    expect(BootstrapGuard).toBeDefined();
    if (!Target || !BootstrapGuard) return;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Target)).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, Target)).toBe(
      'engineering/supervisor/worker',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, Target)).toEqual([
      BootstrapGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, Target)).not.toContain(
      SupervisorWorkerGuard,
    );
    expect(Reflect.getMetadata(PATH_METADATA, Target.prototype.claimNext)).toBe(
      'claim-next',
    );
    expect(
      Reflect.getMetadata(METHOD_METADATA, Target.prototype.claimNext),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, Target.prototype.claimNext),
    ).toBe(200);
  });

  it('uses server-fixed role and server-generated runner, lease, and bounded time', async () => {
    const value = request({
      workerRole: 'supervisor',
      runnerId: 'caller-runner',
      leaseId: 'caller-lease',
      now: new Date('2000-01-01T00:00:00.000Z'),
      leaseExpiresAt: new Date('2000-01-01T00:00:01.000Z'),
    });
    const setupValue = setup();
    if (!setupValue) return;

    await invoke(setupValue.controller, value, {
      workerRole: 'supervisor',
      runnerId: 'body-runner',
      leaseId: 'body-lease',
    });
    expect(setupValue.calls.claimNext).toHaveBeenCalledWith(
      expect.objectContaining({
        workerRole: 'backend',
        executionPurpose: 'IMPLEMENTATION',
        requireFrozenBaseSha: false,
        runnerId: expect.any(String),
        leaseId: expect.any(String),
        now: expect.any(Date),
        leaseExpiresAt: expect.any(Date),
      }),
    );
    const input = setupValue.calls.claimNext.mock.calls[0][0];
    expect(input.leaseExpiresAt.getTime()).toBeGreaterThan(
      input.now.getTime(),
    );
    expect(input.runnerId).not.toBe('caller-runner');
    expect(input.leaseId).not.toBe('caller-lease');
  });

  it('rejects an invalid execution purpose before claiming any execution', async () => {
    const setupValue = setup();
    if (!setupValue) return;

    await expect(
      invoke(setupValue.controller, request(), {
        executionPurpose: 'DEPLOY_PRODUCTION',
      }),
    ).rejects.toThrow('worker_execution_purpose_invalid');
    expect(setupValue.calls.claimNext).not.toHaveBeenCalled();
    expect(setupValue.calls.issueWorker).not.toHaveBeenCalled();
    expect(setupValue.calls.issueVerifier).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean frozen-base requirement before claiming', async () => {
    const setupValue = setup();
    if (!setupValue) return;

    await expect(
      invoke(setupValue.controller, request(), {
        executionPurpose: 'IMPLEMENTATION',
        requireFrozenBaseSha: 'yes',
      }),
    ).rejects.toThrow('worker_frozen_base_requirement_invalid');
    expect(setupValue.calls.claimNext).not.toHaveBeenCalled();
  });

  it('passes candidate-only frozen-base requirement into atomic claim selection', async () => {
    const setupValue = setup(null);
    if (!setupValue) return;

    await invoke(setupValue.controller, request(), {
      executionPurpose: 'IMPLEMENTATION',
      requireFrozenBaseSha: true,
    });

    expect(setupValue.calls.claimNext).toHaveBeenCalledWith(
      expect.objectContaining({
        workerRole: 'backend',
        executionPurpose: 'IMPLEMENTATION',
        requireFrozenBaseSha: true,
      }),
    );
  });

  it('returns no content without issuing or persisting a capability when no work exists', async () => {
    const setupValue = setup(null);
    if (!setupValue) return;

    await expect(invoke(setupValue.controller)).resolves.toBeUndefined();
    expect(setupValue.calls.issueWorker).not.toHaveBeenCalled();
    expect(setupValue.calls.issueVerifier).not.toHaveBeenCalled();
    expect(setupValue.calls.saveIfStatus).not.toHaveBeenCalled();
  });

  it('claims before issuing and persists the worker capability metadata only', async () => {
    const claimed = execution();
    const setupValue = setup(claimed);
    if (!setupValue) return;

    const result = await invoke(setupValue.controller);
    expect(setupValue.calls.claimNext.mock.invocationCallOrder[0]).toBeLessThan(
      setupValue.calls.issueWorker.mock.invocationCallOrder[0],
    );
    expect(setupValue.calls.issueWorker).toHaveBeenCalledWith(
      claimed,
      expect.any(Object),
    );
    expect(setupValue.calls.saveIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RUNNING',
        assignment: expect.objectContaining({
          claimEpoch: claimed.claimEpoch,
          runnerId: claimed.assignment.runnerId,
          leaseId: claimed.assignment.leaseId,
          workerCapability: expect.any(Object),
        }),
      }),
      'RUNNING',
    );
    expect(result).toEqual(
      expect.objectContaining({
        capability: 'opaque-worker-capability-token',
      }),
    );
    expect(
      setupValue.calls.saveIfStatus.mock.calls[0][0].assignment.workerCapability,
    ).not.toHaveProperty('token');
  });

  it('does not return success when capability persistence fails', async () => {
    const setupValue = setup();
    if (!setupValue) return;
    setupValue.calls.saveIfStatus.mockRejectedValueOnce(
      new Error('capability_persistence_failed'),
    );

    await expect(invoke(setupValue.controller)).rejects.toThrow(
      'capability_persistence_failed',
    );
    expect(setupValue.calls.claimNext).toHaveBeenCalledTimes(1);
    expect(setupValue.calls.saveIfStatus).toHaveBeenCalledTimes(1);
  });

  it('issues verifier capability for independent verification without worker capability issuance', async () => {
    const claimed = execution('INDEPENDENT_VERIFICATION');
    const setupValue = setup(claimed);
    if (!setupValue) return;

    await invoke(setupValue.controller, request(), {
      executionPurpose: 'INDEPENDENT_VERIFICATION',
    });
    expect(setupValue.calls.claimNext).toHaveBeenCalledWith(
      expect.objectContaining({
        workerRole: 'backend',
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        requireFrozenBaseSha: false,
      }),
    );
    expect(setupValue.calls.issueWorker).not.toHaveBeenCalled();
    expect(setupValue.calls.issueVerifier).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: claimed.taskId,
        executionId: claimed.id,
        manifestHash: claimed.assignment.manifestHash,
        claimEpoch: claimed.claimEpoch,
        allowedPaths: claimed.assignment.allowedPaths,
        purpose: 'INDEPENDENT_VERIFICATION',
        leaseId: claimed.assignment.leaseId,
        runnerId: claimed.assignment.runnerId,
      }),
      expect.any(Date),
    );
    expect(setupValue.calls.saveIfStatus).toHaveBeenCalledWith(
      expect.not.objectContaining({
        assignment: expect.objectContaining({
          workerCapability: expect.anything(),
        }),
      }),
      'RUNNING',
    );
  });
});
