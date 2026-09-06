import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { MemorySupervisorExecutionStore } from '../stores/memory-supervisor-execution.store';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';
import {
  SUPERVISOR_WORKER_OPERATION,
  SupervisorWorkerGuard,
} from './supervisor-worker.guard';
import type { SupervisorWorkerCapabilityOperation } from './supervisor-worker-capability.types';

const NOW = new Date();

function execution(
  id = 'ATLAS-EXEC-1',
  taskId = 'ATLAS-1',
): SupervisorExecution {
  return {
    id,
    taskId,
    workerRole: 'engineering',
    status: 'DISPATCHED',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'engineering',
      executionPurpose: 'IMPLEMENTATION',
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
  };
}

function context(
  token: string | undefined,
  taskId: string,
  executionId: string,
  operation: SupervisorWorkerCapabilityOperation | undefined,
): ExecutionContext {
  const handler = () => undefined;
  if (operation) {
    Reflect.defineMetadata(SUPERVISOR_WORKER_OPERATION, operation, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class WorkerController {},
    switchToHttp: () => ({
      getRequest: () => ({
        method: operation === 'read_assignment' ? 'GET' : 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        params: { taskId, executionId },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('SupervisorWorkerGuard', () => {
  let store: MemorySupervisorExecutionStore;
  let capabilities: SupervisorWorkerCapabilityService;
  let guard: SupervisorWorkerGuard;

  beforeEach(() => {
    store = new MemorySupervisorExecutionStore();
    capabilities = new SupervisorWorkerCapabilityService({
      get: (name: string) =>
        name === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? 'owner-secret' : undefined,
    } as never);
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
});
