import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';
import type { SupervisorWorkerCapabilityOperation } from './supervisor-worker-capability.types';

const OWNER_TOKEN = 'owner-secret-that-must-never-leave-the-server';
const NOW = new Date('2026-09-06T00:00:00.000Z');

function config(ownerToken: string | undefined = OWNER_TOKEN): ConfigService {
  return {
    get: jest.fn((name: string) =>
      name === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? ownerToken : undefined,
    ),
  } as unknown as ConfigService;
}

function execution(
  overrides: Partial<SupervisorExecution> = {},
): SupervisorExecution {
  return {
    id: 'ATLAS-EXEC-20260906-11111111-1111-4111-8111-111111111111',
    taskId: 'ATLAS-20260906-11111111-1111-4111-8111-111111111111',
    workerRole: 'engineering',
    status: 'DISPATCHED',
    assignment: {
      executionId: 'ATLAS-EXEC-20260906-11111111-1111-4111-8111-111111111111',
      taskId: 'ATLAS-20260906-11111111-1111-4111-8111-111111111111',
      workerRole: 'engineering',
      executionPurpose: 'IMPLEMENTATION',
      objective: 'Implement worker capability plane',
      allowedPaths: ['apps/api/src/agent-supervisor/worker/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependencies: [],
      acceptance: ['capability is execution-bound'],
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
    ...overrides,
  };
}

function authorize(
  service: SupervisorWorkerCapabilityService,
  token: string,
  value: SupervisorExecution,
  operation: SupervisorWorkerCapabilityOperation = 'read_assignment',
) {
  return service.authorize(token, {
    taskId: value.taskId,
    executionId: value.id,
    workerRole: value.workerRole,
    executionPurpose: value.assignment.executionPurpose ?? 'IMPLEMENTATION',
    assignment: value.assignment,
    operation,
    now: new Date(NOW.getTime() + 1_000),
  });
}

function tamperPayload(
  token: string,
  mutate: (payload: Record<string, unknown>) => void,
) {
  const [encodedPayload, signature] = token.split('.');
  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  mutate(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
}

describe('SupervisorWorkerCapabilityService', () => {
  it('accepts a valid execution-bound capability', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;

    const claims = authorize(service, issued.token, value);
    expect(claims).toMatchObject({
      taskId: value.taskId,
      executionId: value.id,
      workerRole: 'engineering',
      executionPurpose: 'IMPLEMENTATION',
    });
    expect(claims.allowedOperations).toContain('read_assignment');
    expect(issued.token).not.toContain(OWNER_TOKEN);
    expect(JSON.stringify(issued.metadata)).not.toContain(OWNER_TOKEN);
  });

  it('rejects a tampered payload', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;
    const token = tamperPayload(issued.token, (payload) => {
      payload.workerRole = 'qa';
    });

    expect(() => authorize(service, token, value)).toThrow(
      'worker_capability_invalid_signature',
    );
  });

  it('rejects a tampered signature', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;
    const [payload] = issued.token.split('.');

    expect(() => authorize(service, `${payload}.invalid`, value)).toThrow(
      'worker_capability_invalid_signature',
    );
  });

  it('rejects an expired capability', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW, ttlMs: 1_000 });
    value.assignment.workerCapability = issued.metadata;

    expect(() =>
      service.authorize(issued.token, {
        taskId: value.taskId,
        executionId: value.id,
        workerRole: value.workerRole,
        executionPurpose: 'IMPLEMENTATION',
        assignment: value.assignment,
        operation: 'read_assignment',
        now: new Date(NOW.getTime() + 1_001),
      }),
    ).toThrow('worker_capability_expired');
  });

  it.each([
    ['taskId', { taskId: 'ATLAS-other' }, 'worker_capability_task_mismatch'],
    [
      'executionId',
      { id: 'ATLAS-EXEC-other' },
      'worker_capability_execution_mismatch',
    ],
    ['workerRole', { workerRole: 'qa' }, 'worker_capability_role_mismatch'],
  ] as const)('rejects a wrong %s binding', (_label, overrides, code) => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;
    const changed = execution(overrides);
    changed.assignment.workerCapability = issued.metadata;

    expect(() => authorize(service, issued.token, changed)).toThrow(code);
  });

  it('rejects a wrong execution purpose binding', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;

    expect(() =>
      service.authorize(issued.token, {
        taskId: value.taskId,
        executionId: value.id,
        workerRole: value.workerRole,
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        assignment: value.assignment,
        operation: 'read_assignment',
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).toThrow('worker_capability_purpose_mismatch');
  });

  it('rejects an assignment digest mismatch', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, { now: NOW });
    value.assignment.workerCapability = issued.metadata;
    value.assignment.objective = 'tampered objective';

    expect(() => authorize(service, issued.token, value)).toThrow(
      'worker_capability_assignment_mismatch',
    );
  });

  it('rejects an unauthorized operation', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const value = execution();
    const issued = service.issue(value, {
      now: NOW,
      allowedOperations: ['read_assignment'],
    });
    value.assignment.workerCapability = issued.metadata;

    expect(() => authorize(service, issued.token, value, 'complete')).toThrow(
      'worker_capability_operation_denied',
    );
  });

  it('keeps Engineering and independent verification capabilities isolated', () => {
    const service = new SupervisorWorkerCapabilityService(config());
    const engineering = execution();
    const qa = execution({
      id: 'ATLAS-EXEC-20260906-22222222-2222-4222-8222-222222222222',
      workerRole: 'qa',
      assignment: {
        ...execution().assignment,
        executionId: 'ATLAS-EXEC-20260906-22222222-2222-4222-8222-222222222222',
        workerRole: 'qa',
        executionPurpose: 'INDEPENDENT_VERIFICATION',
      },
    });
    const engineeringIssued = service.issue(engineering, { now: NOW });
    engineering.assignment.workerCapability = engineeringIssued.metadata;
    qa.assignment.workerCapability = engineeringIssued.metadata;

    expect(() => authorize(service, engineeringIssued.token, qa)).toThrow();

    const qaIssued = service.issue(qa, { now: NOW });
    qa.assignment.workerCapability = qaIssued.metadata;
    engineering.assignment.workerCapability = qaIssued.metadata;
    expect(() => authorize(service, qaIssued.token, engineering)).toThrow();
  });

  it('fails closed when server signing material is unavailable', () => {
    const service = new SupervisorWorkerCapabilityService(config(''));

    expect(() => service.issue(execution(), { now: NOW })).toThrow(
      ServiceUnavailableException,
    );
  });
});
