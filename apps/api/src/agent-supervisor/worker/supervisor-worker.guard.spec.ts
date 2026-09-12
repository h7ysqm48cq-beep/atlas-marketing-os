import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import {
  SUPERVISOR_WORKER_OPERATION,
  SupervisorWorkerGuard,
} from './supervisor-worker.guard';
import type { SupervisorWorkerCapabilityOperation } from './supervisor-worker-capability.types';

const NOW = new Date();

function execution(
  id = 'ATLAS-EXEC-1',
  taskId = 'ATLAS-1',
  overrides: Partial<SupervisorExecution> = {},
): SupervisorExecution {
  const value: SupervisorExecution = {
    id,
    taskId,
    workerRole: 'engineering',
    status: 'DISPATCHED',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'engineering',
      executionPurpose: 'IMPLEMENTATION',
      manifestHash: 'a'.repeat(64),
      claimEpoch: 1,
      leaseId: 'lease-1',
      runnerId: 'runner-1',
      objective: 'Worker capability plane',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependencies: [],
      acceptance: ['isolated'],
      requiredEvidence: [
        'rootCause',
        'changedFiles',
        'tests',
        'build',
        'regression',
        'deploymentState',
        'gitState',
        'remainingRisk',
      ],
    },
    result: null,
    error: null,
    createdAt: NOW,
    startedAt: null,
    completedAt: null,
    runnerId: null,
    claimEpoch: 0,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
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

function claimedExecution(
  overrides: Partial<SupervisorExecution> = {},
): SupervisorExecution {
  return execution('ATLAS-EXEC-1', 'ATLAS-1', {
    status: 'RUNNING',
    runnerId: 'runner-4',
    claimEpoch: 4,
    lastHeartbeatAt: new Date(NOW.getTime() - 10_000),
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
    assignment: {
      ...execution().assignment,
      claimEpoch: 4,
      leaseId: 'lease-4',
      runnerId: 'runner-4',
      ...(overrides.assignment ?? {}),
    },
  });
}

function context(
  token: string | undefined,
  taskId: string,
  executionId: string,
  operation: SupervisorWorkerCapabilityOperation | undefined,
  requestHolder?: { request?: Record<string, unknown> },
): ExecutionContext {
  const handler = () => undefined;
  if (operation) {
    Reflect.defineMetadata(SUPERVISOR_WORKER_OPERATION, operation, handler);
  }
  const request = {
    method: operation === 'read_assignment' ? 'GET' : 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    params: { taskId, executionId },
  };
  if (requestHolder) requestHolder.request = request;
  return {
    getHandler: () => handler,
    getClass: () => class WorkerController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('SupervisorWorkerGuard', () => {
  let store: MemorySupervisorExecutionStore;
  let capabilities: SupervisorWorkerCapabilityService;
  let guard: SupervisorWorkerGuard;

  beforeEach(() => {
    store = new MemorySupervisorExecutionStore();
    capabilities = new SupervisorWorkerCapabilityService(
      createTestSupervisorAuthority(),
    );
    guard = new SupervisorWorkerGuard(capabilities, store, new Reflector());
  });

  async function persistIssued(value: SupervisorExecution) {
    const issued = capabilities.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;
    await store.create(value);
    return issued.token;
  }

  it('allows a valid capability to read its own assignment', async () => {
    const value = execution();
    const token = await persistIssued(value);

    await expect(
      guard.canActivate(
        context(token, value.taskId, value.id, 'read_assignment'),
      ),
    ).resolves.toBe(true);
  });

  it('prevents capability A from accessing execution B', async () => {
    const first = execution('ATLAS-EXEC-A', 'ATLAS-A');
    const second = execution('ATLAS-EXEC-B', 'ATLAS-B');
    const token = await persistIssued(first);
    await persistIssued(second);

    await expect(
      guard.canActivate(
        context(token, second.taskId, second.id, 'read_assignment'),
      ),
    ).rejects.toThrow('worker_capability_task_mismatch');
  });

  it('rejects missing, malformed, and invalid capabilities', async () => {
    const value = execution();
    await persistIssued(value);

    await expect(
      guard.canActivate(
        context(undefined, value.taskId, value.id, 'read_assignment'),
      ),
    ).rejects.toThrow('worker_capability_required');
    await expect(
      guard.canActivate(
        context('owner-secret', value.taskId, value.id, 'read_assignment'),
      ),
    ).rejects.toThrow('worker_capability_malformed');
  });

  it('rejects a worker operation that was not explicitly declared', async () => {
    const value = execution();
    const token = await persistIssued(value);

    await expect(
      guard.canActivate(context(token, value.taskId, value.id, undefined)),
    ).rejects.toThrow('worker_capability_operation_not_declared');
  });

  it('rejects worker mutations after execution is terminal', async () => {
    const value = execution();
    const token = await persistIssued(value);
    value.status = 'COMPLETED';
    await store.save(value);

    await expect(
      guard.canActivate(context(token, value.taskId, value.id, 'complete')),
    ).rejects.toThrow('worker_capability_terminal_execution');
  });

  it('still permits read-only assignment access after execution is terminal', async () => {
    const value = execution();
    const token = await persistIssued(value);
    value.status = 'COMPLETED';
    await store.save(value);

    await expect(
      guard.canActivate(
        context(token, value.taskId, value.id, 'read_assignment'),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a persisted assignment purpose change', async () => {
    const value = execution();
    const token = await persistIssued(value);
    value.assignment.executionPurpose = 'INDEPENDENT_VERIFICATION';
    await store.save(value);

    await expect(
      guard.canActivate(
        context(token, value.taskId, value.id, 'read_assignment'),
      ),
    ).rejects.toThrow('worker_capability_purpose_mismatch');
  });

  it.each(['QUEUED', 'DISPATCHED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const)(
    'rejects heartbeat authorization for %s executions',
    async (status) => {
      const value = claimedExecution({ status });
      const token = await persistIssued(value);
      const heartbeat = 'heartbeat' as SupervisorWorkerCapabilityOperation;

      await expect(
        guard.canActivate(context(token, value.taskId, value.id, heartbeat)),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('worker_capability_operation_denied'),
      });
    },
  );

  it('rejects heartbeat authorization after the persisted RUNNING lease expires', async () => {
    const value = claimedExecution({
      lastHeartbeatAt: new Date(NOW.getTime() - 120_000),
      leaseExpiresAt: new Date(NOW.getTime() - 1),
    });
    const token = await persistIssued(value);
    const heartbeat = 'heartbeat' as SupervisorWorkerCapabilityOperation;
    jest.useFakeTimers().setSystemTime(NOW);

    try {
      await expect(
        guard.canActivate(context(token, value.taskId, value.id, heartbeat)),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('worker_capability_operation_denied'),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['claimEpoch', { claimEpoch: 5 }],
    ['runnerId', { runnerId: 'runner-other' }],
  ] as const)(
    'rejects heartbeat when top-level %s differs from the assignment claim',
    async (_label, override) => {
      const value = claimedExecution(override);
      const token = await persistIssued(value);
      const heartbeat = 'heartbeat' as SupervisorWorkerCapabilityOperation;

      await expect(
        guard.canActivate(context(token, value.taskId, value.id, heartbeat)),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('worker_capability_operation_denied'),
      });
    },
  );

  it('rejects heartbeat when the capability-bound lease differs from persisted assignment', async () => {
    const value = claimedExecution();
    const issued = capabilities.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;
    value.assignment.leaseId = 'lease-other';
    await store.create(value);
    const heartbeat = 'heartbeat' as SupervisorWorkerCapabilityOperation;

    await expect(
      guard.canActivate(context(issued.token, value.taskId, value.id, heartbeat)),
    ).rejects.toThrow('worker_capability_assignment_mismatch');
  });

  it('attaches only the verified claim binding for a valid heartbeat authorization', async () => {
    const value = claimedExecution();
    const token = await persistIssued(value);
    const heartbeat = 'heartbeat' as SupervisorWorkerCapabilityOperation;
    const holder: { request?: Record<string, unknown> } = {};

    await expect(
      guard.canActivate(
        context(token, value.taskId, value.id, heartbeat, holder),
      ),
    ).resolves.toBe(true);

    expect(holder.request?.supervisorWorkerAuthorization).toEqual({
      taskId: value.taskId,
      executionId: value.id,
      workerRole: value.workerRole,
      claimEpoch: 4,
      runnerId: 'runner-4',
      leaseId: 'lease-4',
    });
    expect(holder.request?.token).toBeUndefined();
  });
});
