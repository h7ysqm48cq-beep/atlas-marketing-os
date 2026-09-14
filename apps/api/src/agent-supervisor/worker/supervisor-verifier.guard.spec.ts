import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import { VerifierCapabilityService } from '../authority/verifier-capability.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';

const NOW = new Date('2026-09-14T09:00:00.000Z');

function loadVerifierGuardModule(): any {
  try {
    return require('./supervisor-verifier.guard');
  } catch {
    return {};
  }
}

function verifierExecution(
  overrides: Partial<SupervisorExecution> = {},
): SupervisorExecution {
  const id = 'ATLAS-EXEC-VERIFIER-1';
  const taskId = 'ATLAS-VERIFIER-1';
  const value: SupervisorExecution = {
    id,
    taskId,
    workerRole: 'engineering',
    status: 'RUNNING',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'engineering',
      executionPurpose: 'INDEPENDENT_VERIFICATION',
      manifestHash: 'a'.repeat(64),
      claimEpoch: 4,
      leaseId: 'lease-verifier-4',
      runnerId: 'runner-verifier-4',
      objective: 'Verify Engineering Runner integration',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependencies: [],
      acceptance: ['independent verification'],
      requiredEvidence: [],
    },
    result: null,
    error: null,
    createdAt: new Date(NOW.getTime() - 20_000),
    startedAt: new Date(NOW.getTime() - 10_000),
    completedAt: null,
    runnerId: 'runner-verifier-4',
    claimEpoch: 4,
    lastHeartbeatAt: new Date(NOW.getTime() - 5_000),
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
  };
  return {
    ...value,
    ...overrides,
    assignment: {
      ...value.assignment,
      ...(overrides.assignment ?? {}),
    },
  };
}

function verifierInput(value: SupervisorExecution) {
  return {
    taskId: value.taskId,
    executionId: value.id,
    manifestHash: value.assignment.manifestHash!,
    claimEpoch: value.claimEpoch,
    allowedPaths: value.assignment.allowedPaths,
    purpose: 'INDEPENDENT_VERIFICATION' as const,
    leaseId: value.assignment.leaseId!,
    runnerId: value.runnerId!,
  };
}

function context(
  operationKey: string,
  operation: string,
  token: string | undefined,
  taskId: string,
  executionId: string,
  holder?: { request?: Record<string, unknown> },
): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(operationKey, operation, handler);
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    params: { taskId, executionId },
  };
  if (holder) holder.request = request;
  return {
    getHandler: () => handler,
    getClass: () => class VerifierController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SupervisorVerifierGuard RED contract', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(value = verifierExecution()) {
    const module = loadVerifierGuardModule();
    const Guard = module.SupervisorVerifierGuard;
    const operationKey = module.SUPERVISOR_VERIFIER_OPERATION;
    expect(Guard).toBeDefined();
    expect(operationKey).toBeDefined();
    if (!Guard || !operationKey) return undefined;

    const store = new MemorySupervisorExecutionStore();
    const authority = createTestSupervisorAuthority();
    const verifierCapabilities = new VerifierCapabilityService(authority);
    const workerCapabilities = new SupervisorWorkerCapabilityService(authority);
    const guard = new Guard(verifierCapabilities, store, new Reflector());
    return {
      guard,
      store,
      verifierCapabilities,
      workerCapabilities,
      operationKey,
      value,
    };
  }

  it('accepts only a valid independent-verification capability for its own assignment', async () => {
    const value = verifierExecution();
    const setupValue = setup(value);
    if (!setupValue) return;
    await setupValue.store.create(value);
    const token = setupValue.verifierCapabilities.issue(verifierInput(value), NOW);

    await expect(
      setupValue.guard.canActivate(
        context(
          setupValue.operationKey,
          'read_assignment',
          token,
          value.taskId,
          value.id,
        ),
      ),
    ).resolves.toBe(true);
  });

  it('rejects an implementation worker capability at the verifier gateway', async () => {
    const value = verifierExecution();
    const setupValue = setup(value);
    if (!setupValue) return;
    await setupValue.store.create(value);

    const implementation = {
      ...value,
      assignment: {
        ...value.assignment,
        executionPurpose: 'IMPLEMENTATION' as const,
      },
    };
    const issued = setupValue.workerCapabilities.issue(implementation, { now: NOW });

    await expect(
      setupValue.guard.canActivate(
        context(
          setupValue.operationKey,
          'read_assignment',
          issued.token,
          value.taskId,
          value.id,
        ),
      ),
    ).rejects.toBeDefined();
  });

  it('fails closed when heartbeat is attempted after the verifier lease expires', async () => {
    const value = verifierExecution({
      leaseExpiresAt: new Date(NOW.getTime() - 1),
    });
    const setupValue = setup(value);
    if (!setupValue) return;
    await setupValue.store.create(value);
    const token = setupValue.verifierCapabilities.issue(verifierInput(value), NOW);

    await expect(
      setupValue.guard.canActivate(
        context(
          setupValue.operationKey,
          'heartbeat',
          token,
          value.taskId,
          value.id,
        ),
      ),
    ).rejects.toThrow('verifier_capability_execution_lease_expired');
  });

  it('attaches only the verified claim binding for heartbeat renewal', async () => {
    const value = verifierExecution();
    const setupValue = setup(value);
    if (!setupValue) return;
    await setupValue.store.create(value);
    const token = setupValue.verifierCapabilities.issue(verifierInput(value), NOW);
    const holder: { request?: Record<string, unknown> } = {};

    await expect(
      setupValue.guard.canActivate(
        context(
          setupValue.operationKey,
          'heartbeat',
          token,
          value.taskId,
          value.id,
          holder,
        ),
      ),
    ).resolves.toBe(true);

    expect(holder.request?.supervisorVerifierAuthorization).toEqual({
      taskId: value.taskId,
      executionId: value.id,
      workerRole: value.workerRole,
      claimEpoch: value.claimEpoch,
      runnerId: value.runnerId,
      leaseId: value.assignment.leaseId,
    });
  });
});
