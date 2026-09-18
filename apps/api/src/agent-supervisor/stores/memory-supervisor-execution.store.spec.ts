import type {
  SupervisorExecution,
  SupervisorWorkerRole,
} from '../execution/supervisor-execution.types';
import { MemorySupervisorExecutionStore } from './memory-supervisor-execution.store';

function executionFixture(id: string, taskId: string): SupervisorExecution {
  const now = new Date('2026-08-30T00:00:00.000Z');
  return {
    id,
    taskId,
    workerRole: 'backend',
    status: 'QUEUED',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'backend',
      objective: 'Implement bounded backend change',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      dependencies: [],
      acceptance: ['passes'],
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
    createdAt: now,
    startedAt: null,
    completedAt: null,
    runnerId: null,
    claimEpoch: 0,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
  };
}

type ExecutionLivenessFields = {
  runnerId: string | null;
  claimEpoch: number;
  lastHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
};

function executionWithLiveness(
  id: string,
  taskId: string,
): SupervisorExecution & ExecutionLivenessFields {
  return {
    ...executionFixture(id, taskId),
    runnerId: 'runner-s2-red',
    claimEpoch: 3,
    lastHeartbeatAt: new Date('2026-09-12T01:02:03.000Z'),
    leaseExpiresAt: new Date('2026-09-12T01:12:03.000Z'),
  };
}

type ClaimNextInput = {
  workerRole: SupervisorExecution['workerRole'];
  executionPurpose?: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';
  runnerId: string;
  leaseId: string;
  now: Date;
  leaseExpiresAt: Date;
};

type ClaimNextStore = {
  claimNext(input: ClaimNextInput): Promise<SupervisorExecution | null>;
};

function claimStore(store: MemorySupervisorExecutionStore): ClaimNextStore {
  return store as unknown as ClaimNextStore;
}

type HeartbeatInput = {
  executionId: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  claimEpoch: number;
  runnerId: string;
  leaseId: string;
  now: Date;
  leaseExpiresAt: Date;
};

type HeartbeatStore = {
  heartbeat(input: HeartbeatInput): Promise<SupervisorExecution | null>;
};

function heartbeatStore(store: MemorySupervisorExecutionStore): HeartbeatStore {
  return store as unknown as HeartbeatStore;
}

function heartbeatFixture(
  status: SupervisorExecution['status'] = 'RUNNING',
): SupervisorExecution {
  const fixture = executionFixture('EXEC-HEARTBEAT', 'ATLAS-1');
  fixture.status = status;
  fixture.startedAt = new Date('2026-09-13T00:00:00.000Z');
  fixture.runnerId = 'runner-3';
  fixture.claimEpoch = 3;
  fixture.lastHeartbeatAt = new Date('2026-09-13T00:00:20.000Z');
  fixture.leaseExpiresAt = new Date('2026-09-13T00:01:20.000Z');
  fixture.assignment = {
    ...fixture.assignment,
    claimEpoch: 3,
    runnerId: 'runner-3',
    leaseId: 'lease-3',
    manifestHash: 'a'.repeat(64),
  };
  return fixture;
}

function validHeartbeatInput(): HeartbeatInput {
  return {
    executionId: 'EXEC-HEARTBEAT',
    taskId: 'ATLAS-1',
    workerRole: 'backend',
    claimEpoch: 3,
    runnerId: 'runner-3',
    leaseId: 'lease-3',
    now: new Date('2026-09-13T00:00:30.000Z'),
    leaseExpiresAt: new Date('2026-09-13T00:01:30.000Z'),
  };
}

describe('MemorySupervisorExecutionStore', () => {
  it('exposes asynchronous store operations', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-1', 'ATLAS-1');

    const createResult = store.create(fixture);
    expect(createResult).toBeInstanceOf(Promise);
    await createResult;

    expect(store.get('EXEC-1')).toBeInstanceOf(Promise);
    expect(store.listByTask('ATLAS-1')).toBeInstanceOf(Promise);
    expect(store.save(fixture)).toBeInstanceOf(Promise);
  });

  it('keeps execution history per task in creation order', async () => {
    const store = new MemorySupervisorExecutionStore();
    await store.create(executionFixture('EXEC-1', 'ATLAS-1'));
    await store.create(executionFixture('EXEC-2', 'ATLAS-1'));
    await store.create(executionFixture('EXEC-3', 'ATLAS-2'));

    expect((await store.listByTask('ATLAS-1')).map((x) => x.id)).toEqual([
      'EXEC-1',
      'EXEC-2',
    ]);
  });

  it('returns clones so callers cannot mutate stored execution state', async () => {
    const store = new MemorySupervisorExecutionStore();
    const created = await store.create(executionFixture('EXEC-1', 'ATLAS-1'));

    created.status = 'FAILED';
    created.assignment.allowedPaths.push('outside.ts');

    const stored = await store.get('EXEC-1');
    expect(stored?.status).toBe('QUEUED');
    expect(stored?.assignment.allowedPaths).toEqual([
      'apps/api/src/example.ts',
    ]);
  });

  it('defensively clones execution liveness fields', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionWithLiveness('EXEC-1', 'ATLAS-1');
    await store.create(fixture);

    const stored = (await store.get('EXEC-1')) as
      | (SupervisorExecution & ExecutionLivenessFields)
      | null;

    expect(stored).toMatchObject({
      runnerId: 'runner-s2-red',
      claimEpoch: 3,
      lastHeartbeatAt: new Date('2026-09-12T01:02:03.000Z'),
      leaseExpiresAt: new Date('2026-09-12T01:12:03.000Z'),
    });
    expect(stored?.lastHeartbeatAt).not.toBe(fixture.lastHeartbeatAt);
    expect(stored?.leaseExpiresAt).not.toBe(fixture.leaseExpiresAt);
  });

  it('round-trips execution purpose and non-secret capability metadata', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-1', 'ATLAS-1');
    fixture.assignment.executionPurpose = 'INDEPENDENT_VERIFICATION';
    fixture.assignment.workerCapability = {
      version: 2,
      assignmentDigest: 'a'.repeat(64),
      allowedActions: ['read_assignment', 'mark_running'],
      manifestHash: 'b'.repeat(64),
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge'],
      claimEpoch: 1,
      leaseId: 'lease-1',
      runnerId: 'runner-1',
      jti: 'jti-1',
      issuedAt: '2026-09-06T00:00:00.000Z',
      expiresAt: '2026-09-06T00:05:00.000Z',
    };

    await store.create(fixture);

    await expect(store.get(fixture.id)).resolves.toMatchObject({
      assignment: {
        executionPurpose: 'INDEPENDENT_VERIFICATION',
        workerCapability: fixture.assignment.workerCapability,
      },
    });
  });

  it('allows only one concurrent terminal write from RUNNING', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-1', 'ATLAS-1');
    fixture.status = 'RUNNING';
    await store.create(fixture);
    const completed = { ...fixture, status: 'COMPLETED' as const };
    const failed = { ...fixture, status: 'FAILED' as const };

    const results = await Promise.allSettled([
      store.saveIfStatus(completed, 'RUNNING'),
      store.saveIfStatus(failed, 'RUNNING'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const stored = await store.get(fixture.id);
    expect(['COMPLETED', 'FAILED']).toContain(stored?.status);
  });

  it('claims the oldest matching QUEUED execution', async () => {
    const store = new MemorySupervisorExecutionStore();
    const newer = executionFixture('EXEC-NEWER', 'ATLAS-1');
    newer.createdAt = new Date('2026-09-13T00:02:00.000Z');
    const otherRole = executionFixture('EXEC-FRONTEND', 'ATLAS-1');
    otherRole.assignment.workerRole = 'frontend';
    otherRole.workerRole = 'frontend';
    const older = executionFixture('EXEC-OLDER', 'ATLAS-1');
    older.createdAt = new Date('2026-09-13T00:01:00.000Z');

    await store.create(newer);
    await store.create(otherRole);
    await store.create(older);

    const result = await claimStore(store).claimNext({
      workerRole: 'backend',
      runnerId: 'runner-s4a-oldest',
      leaseId: 'lease-s4a-oldest',
      now: new Date('2026-09-13T00:03:00.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
    });

    expect(result).toMatchObject({
      id: 'EXEC-OLDER',
      status: 'RUNNING',
      runnerId: 'runner-s4a-oldest',
      claimEpoch: 1,
    });
    await expect(store.get('EXEC-NEWER')).resolves.toMatchObject({
      status: 'QUEUED',
    });
    await expect(store.get('EXEC-FRONTEND')).resolves.toMatchObject({
      status: 'QUEUED',
      workerRole: 'frontend',
    });
  });

  it('claims only the requested execution purpose for the same worker role', async () => {
    const store = new MemorySupervisorExecutionStore();
    const verifier = executionFixture('EXEC-VERIFY', 'ATLAS-VERIFY');
    verifier.createdAt = new Date('2026-09-13T00:01:00.000Z');
    verifier.assignment.executionPurpose = 'INDEPENDENT_VERIFICATION';
    const implementation = executionFixture('EXEC-IMPLEMENT', 'ATLAS-IMPLEMENT');
    implementation.createdAt = new Date('2026-09-13T00:02:00.000Z');
    implementation.assignment.executionPurpose = 'IMPLEMENTATION';

    await store.create(verifier);
    await store.create(implementation);

    const implementationClaim = await claimStore(store).claimNext({
      workerRole: 'backend',
      executionPurpose: 'IMPLEMENTATION',
      runnerId: 'runner-implementation',
      leaseId: 'lease-implementation',
      now: new Date('2026-09-13T00:03:00.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
    });

    expect(implementationClaim?.id).toBe('EXEC-IMPLEMENT');
    await expect(store.get('EXEC-VERIFY')).resolves.toMatchObject({
      status: 'QUEUED',
      assignment: { executionPurpose: 'INDEPENDENT_VERIFICATION' },
    });

    const verifierClaim = await claimStore(store).claimNext({
      workerRole: 'backend',
      executionPurpose: 'INDEPENDENT_VERIFICATION',
      runnerId: 'runner-verifier',
      leaseId: 'lease-verifier',
      now: new Date('2026-09-13T00:04:00.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:14:00.000Z'),
    });

    expect(verifierClaim?.id).toBe('EXEC-VERIFY');
  });

  it('skips non-QUEUED and role-incompatible executions', async () => {
    const store = new MemorySupervisorExecutionStore();
    const dispatched = executionFixture('EXEC-DISPATCHED', 'ATLAS-1');
    dispatched.status = 'DISPATCHED';
    const running = executionFixture('EXEC-RUNNING', 'ATLAS-1');
    running.status = 'RUNNING';
    const completed = executionFixture('EXEC-COMPLETED', 'ATLAS-1');
    completed.status = 'COMPLETED';
    const frontend = executionFixture('EXEC-FRONTEND', 'ATLAS-1');
    frontend.workerRole = 'frontend';
    frontend.assignment.workerRole = 'frontend';

    await store.create(dispatched);
    await store.create(running);
    await store.create(completed);
    await store.create(frontend);

    await expect(
      claimStore(store).claimNext({
        workerRole: 'backend',
        runnerId: 'runner-s4a-ineligible',
        leaseId: 'lease-s4a-ineligible',
        now: new Date('2026-09-13T00:03:00.000Z'),
        leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
      }),
    ).resolves.toBeNull();

    expect(
      (await store.listByTask('ATLAS-1')).map((execution) => execution.status),
    ).toEqual(['DISPATCHED', 'RUNNING', 'COMPLETED', 'QUEUED']);
  });

  it('allows exactly one concurrent claim of a single QUEUED execution', async () => {
    const store = new MemorySupervisorExecutionStore();
    await store.create(executionFixture('EXEC-ONE', 'ATLAS-1'));

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        claimStore(store).claimNext({
          workerRole: 'backend',
          runnerId: `runner-s4a-${index}`,
          leaseId: `lease-s4a-${index}`,
          now: new Date('2026-09-13T00:03:00.000Z'),
          leaseExpiresAt: new Date('2026-09-13T00:13:00.000Z'),
        }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(7);
    await expect(store.get('EXEC-ONE')).resolves.toMatchObject({
      status: 'RUNNING',
      claimEpoch: 1,
    });
  });

  it('updates claim binding and liveness fields together', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = executionFixture('EXEC-BINDING', 'ATLAS-1');
    fixture.claimEpoch = 2;
    fixture.assignment = {
      ...fixture.assignment,
      manifestHash: 'a'.repeat(64),
      claimEpoch: 2,
      leaseId: 'lease-s4a-old',
      runnerId: 'runner-s4a-old',
      workerCapability: undefined,
    };
    await store.create(fixture);
    const now = new Date('2026-09-13T00:00:00.000Z');
    const leaseExpiresAt = new Date('2026-09-13T00:01:00.000Z');

    const result = await claimStore(store).claimNext({
      workerRole: 'backend',
      runnerId: 'runner-s4a-new',
      leaseId: 'lease-s4a-new',
      now,
      leaseExpiresAt,
    });

    expect(result).toMatchObject({
      status: 'RUNNING',
      runnerId: 'runner-s4a-new',
      claimEpoch: 3,
      startedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt,
      result: null,
      error: null,
      completedAt: null,
      assignment: {
        executionId: fixture.id,
        taskId: fixture.taskId,
        workerRole: 'backend',
        manifestHash: 'a'.repeat(64),
        claimEpoch: 3,
        leaseId: 'lease-s4a-new',
        runnerId: 'runner-s4a-new',
      },
    });
    expect(result?.assignment.workerCapability).toBeUndefined();
  });

  it('renews a valid RUNNING heartbeat without changing immutable execution state', async () => {
    const store = new MemorySupervisorExecutionStore();
    const fixture = heartbeatFixture();
    fixture.result = {
      summary: 'preserve',
      evidence: {
        rootCause: 'preserve-root-cause',
        changedFiles: [],
        tests: [],
        build: 'preserve-build',
        regression: [],
        deploymentState: 'preserve-deployment-state',
        gitState: 'preserve-git-state',
        remainingRisk: [],
      },
    };
    fixture.error = 'preserve-error';
    await store.create(fixture);
    const before = await store.get(fixture.id);

    const heartbeat = heartbeatStore(store).heartbeat;
    expect(heartbeat).toBeDefined();
    if (!heartbeat) return;

    const result = await heartbeat(validHeartbeatInput());
    expect(result).toMatchObject({
      id: fixture.id,
      taskId: fixture.taskId,
      workerRole: fixture.workerRole,
      status: 'RUNNING',
      runnerId: 'runner-3',
      claimEpoch: 3,
      startedAt: fixture.startedAt,
      lastHeartbeatAt: new Date('2026-09-13T00:00:30.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:01:30.000Z'),
      completedAt: fixture.completedAt,
      result: fixture.result,
      error: fixture.error,
      assignment: {
        claimEpoch: 3,
        runnerId: 'runner-3',
        leaseId: 'lease-3',
        manifestHash: 'a'.repeat(64),
      },
    });
    expect(result?.lastHeartbeatAt).not.toBe(validHeartbeatInput().now);
    expect(result?.leaseExpiresAt).not.toBe(validHeartbeatInput().leaseExpiresAt);
    expect(await store.get(fixture.id)).toEqual({
      ...before,
      lastHeartbeatAt: new Date('2026-09-13T00:00:30.000Z'),
      leaseExpiresAt: new Date('2026-09-13T00:01:30.000Z'),
    });
  });

  it('rejects every mismatched execution binding without mutation', async () => {
    const store = new MemorySupervisorExecutionStore();
    await store.create(heartbeatFixture());
    const before = await store.get('EXEC-HEARTBEAT');
    const heartbeat = heartbeatStore(store).heartbeat;
    expect(heartbeat).toBeDefined();
    if (!heartbeat) return;

    const mismatches: HeartbeatInput[] = [
      { ...validHeartbeatInput(), executionId: 'other-execution' },
      { ...validHeartbeatInput(), taskId: 'other-task' },
      { ...validHeartbeatInput(), workerRole: 'frontend' },
      { ...validHeartbeatInput(), claimEpoch: 4 },
      { ...validHeartbeatInput(), runnerId: 'other-runner' },
      { ...validHeartbeatInput(), leaseId: 'other-lease' },
    ];
    for (const input of mismatches) {
      await expect(heartbeat(input)).resolves.toBeNull();
      await expect(store.get('EXEC-HEARTBEAT')).resolves.toEqual(before);
    }
  });

  it('rejects heartbeat for non-RUNNING or already expired executions', async () => {
    const statuses: SupervisorExecution['status'][] = [
      'QUEUED',
      'DISPATCHED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ];
    const heartbeat = heartbeatStore(new MemorySupervisorExecutionStore()).heartbeat;
    expect(heartbeat).toBeDefined();
    if (!heartbeat) return;

    for (const status of statuses) {
      const store = new MemorySupervisorExecutionStore();
      await store.create(heartbeatFixture(status));
      await expect(heartbeatStore(store).heartbeat(validHeartbeatInput())).resolves.toBeNull();
    }

    const expiredStore = new MemorySupervisorExecutionStore();
    const expired = heartbeatFixture();
    expired.leaseExpiresAt = new Date('2026-09-13T00:00:29.000Z');
    await expiredStore.create(expired);
    await expect(
      heartbeatStore(expiredStore).heartbeat(validHeartbeatInput()),
    ).resolves.toBeNull();
  });

  it('rejects stale or out-of-order heartbeat timestamps and lease extensions', async () => {
    const store = new MemorySupervisorExecutionStore();
    await store.create(heartbeatFixture());
    const before = await store.get('EXEC-HEARTBEAT');
    const heartbeat = heartbeatStore(store).heartbeat;
    expect(heartbeat).toBeDefined();
    if (!heartbeat) return;

    await expect(
      heartbeat({
        ...validHeartbeatInput(),
        now: new Date('2026-09-13T00:00:10.000Z'),
        leaseExpiresAt: new Date('2026-09-13T00:01:10.000Z'),
      }),
    ).resolves.toBeNull();
    await expect(
      heartbeat({
        ...validHeartbeatInput(),
        now: new Date('2026-09-13T00:00:30.000Z'),
        leaseExpiresAt: new Date('2026-09-13T00:01:20.000Z'),
      }),
    ).resolves.toBeNull();
    await expect(store.get('EXEC-HEARTBEAT')).resolves.toEqual(before);
  });
});
