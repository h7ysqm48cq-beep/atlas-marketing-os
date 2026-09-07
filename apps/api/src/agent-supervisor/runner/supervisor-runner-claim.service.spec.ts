import type { PrismaService } from '../../database/prisma.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { SupervisorExecutionRecord } from '../persistence/supervisor-persistence.mapper';
import type { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import type { SupervisorWorkerCapabilityMetadata } from '../worker/supervisor-worker-capability.types';
import { SupervisorRunnerClaimService } from './supervisor-runner-claim.service';

const NOW = new Date('2026-09-07T10:00:00.000Z');
const LIVE_LEASE = new Date('2026-09-07T10:01:00.000Z');
const EXPIRED_LEASE = new Date('2026-09-07T09:59:00.000Z');
const EXPECTED_LEASE = new Date('2026-09-07T10:02:00.000Z');

const CAPABILITY_METADATA: SupervisorWorkerCapabilityMetadata = {
  version: 2,
  assignmentDigest: 'a'.repeat(64),
  allowedOperations: [
    'read_assignment',
    'mark_running',
    'complete',
    'fail',
    'cancel',
  ],
  issuedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
};

function row(
  overrides: Partial<SupervisorExecutionRecord> = {},
): SupervisorExecutionRecord {
  const id = overrides.id ?? 'ATLAS-EXEC-CLAIM-1';
  const taskId = overrides.taskId ?? 'ATLAS-TASK-CLAIM-1';
  return {
    id,
    taskId,
    workerRole: 'AI_ENGINEER',
    status: 'DISPATCHED',
    assignment: {
      executionId: id,
      taskId,
      workerRole: 'AI_ENGINEER',
      executionPurpose: 'IMPLEMENTATION',
      runnerEligibility: 'A1_SYNTHETIC',
      objective: 'Prove atomic runner ownership',
      allowedPaths: ['apps/api/src/agent-supervisor/runner'],
      forbiddenActions: ['deploy_production'],
      dependencies: [],
      acceptance: ['atomic claim'],
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
    claimedBy: null,
    claimEpoch: 0,
    claimedAt: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    createdAt: new Date('2026-09-07T09:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function recordFromUpdate(
  original: SupervisorExecutionRecord,
  data: Record<string, unknown>,
): SupervisorExecutionRecord {
  return {
    ...original,
    ...data,
    assignment: structuredClone(data.assignment ?? original.assignment),
  } as SupervisorExecutionRecord;
}

function setup(queryResults: SupervisorExecutionRecord[][]) {
  const results = [...queryResults];
  const queryRaw = jest.fn(async () => results.shift() ?? []);
  let updateBase: SupervisorExecutionRecord | null = null;
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (!updateBase) throw new Error('update base not configured');
    return recordFromUpdate(updateBase, data);
  });
  const tx = {
    $queryRaw: queryRaw,
    supervisorExecution: { update },
  };
  const transaction = jest.fn(async (callback: (input: typeof tx) => unknown) =>
    callback(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const issue = jest.fn(
    (execution: SupervisorExecution, options?: { now?: Date }) => {
      expect(options?.now).toEqual(NOW);
      expect(execution.claimedBy).toBeTruthy();
      expect(execution.claimEpoch).toBeGreaterThan(0);
      expect(execution.leaseExpiresAt).toEqual(EXPECTED_LEASE);
      return {
        token: 'runner-capability-token',
        metadata: CAPABILITY_METADATA,
      };
    },
  );
  const capability = { issue } as unknown as SupervisorWorkerCapabilityService;
  const service = new SupervisorRunnerClaimService(prisma, capability);
  return {
    service,
    queryRaw,
    update,
    issue,
    setUpdateBase(value: SupervisorExecutionRecord) {
      updateBase = value;
    },
  };
}

function queryText(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  return Array.from(strings).join('?');
}

describe('SupervisorRunnerClaimService', () => {
  it('claims the oldest eligible synthetic implementation row with SKIP LOCKED predicates', async () => {
    const oldest = row();
    const harness = setup([[], [oldest]]);
    harness.setUpdateBase(oldest);

    const result = await harness.service.claimNext('engineering-runner:one', NOW);

    expect(result).toMatchObject({
      claimed: true,
      execution: { id: oldest.id, status: 'DISPATCHED' },
      claimEpoch: 1,
      leaseExpiresAt: EXPECTED_LEASE.toISOString(),
      capability: 'runner-capability-token',
    });
    expect(harness.queryRaw).toHaveBeenCalledTimes(2);
    const candidateSql = queryText(harness.queryRaw.mock.calls[1]);
    expect(candidateSql).toContain('"status" = \'DISPATCHED\'');
    expect(candidateSql).toContain('"claimedBy" IS NULL');
    expect(candidateSql).toContain('"leaseExpiresAt" <=');
    expect(candidateSql).toContain(
      '"assignment"->>\'executionPurpose\' = \'IMPLEMENTATION\'',
    );
    expect(candidateSql).toContain(
      '"assignment"->>\'runnerEligibility\' = \'A1_SYNTHETIC\'',
    );
    expect(candidateSql).toContain('ORDER BY "createdAt" ASC');
    expect(candidateSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(candidateSql).not.toContain('RUNNING');
  });

  it('returns claimed false when no eligible row exists', async () => {
    const harness = setup([[], []]);

    await expect(
      harness.service.claimNext('engineering-runner:idle', NOW),
    ).resolves.toEqual({ claimed: false });
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('rejects a runner that already owns a live dispatched execution', async () => {
    const owned = row({
      claimedBy: 'engineering-runner:one',
      claimEpoch: 3,
      leaseExpiresAt: LIVE_LEASE,
    });
    const harness = setup([[owned]]);

    await expect(
      harness.service.claimNext('engineering-runner:one', NOW),
    ).rejects.toMatchObject({
      response: { code: 'runner_already_holds_active_execution' },
    });
    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('rejects a runner that owns RUNNING work even when its lease is expired', async () => {
    const owned = row({
      status: 'RUNNING',
      claimedBy: 'engineering-runner:one',
      claimEpoch: 4,
      leaseExpiresAt: EXPIRED_LEASE,
    });
    const harness = setup([[owned]]);

    await expect(
      harness.service.claimNext('engineering-runner:one', NOW),
    ).rejects.toMatchObject({
      response: { code: 'runner_already_holds_active_execution' },
    });
    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reclaims the same runner expired DISPATCHED row before unrelated work', async () => {
    const owned = row({
      id: 'ATLAS-EXEC-RECOVERY',
      claimedBy: 'engineering-runner:one',
      claimEpoch: 7,
      leaseExpiresAt: EXPIRED_LEASE,
    });
    const harness = setup([[owned]]);
    harness.setUpdateBase(owned);

    const result = await harness.service.claimNext('engineering-runner:one', NOW);

    expect(result).toMatchObject({
      claimed: true,
      execution: { id: 'ATLAS-EXEC-RECOVERY' },
      claimEpoch: 8,
    });
    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.issue).toHaveBeenCalledTimes(1);
  });

  it('reclaims an expired dispatched candidate owned by another runner', async () => {
    const expired = row({
      claimedBy: 'engineering-runner:old',
      claimEpoch: 2,
      leaseExpiresAt: EXPIRED_LEASE,
    });
    const harness = setup([[], [expired]]);
    harness.setUpdateBase(expired);

    const result = await harness.service.claimNext('engineering-runner:new', NOW);

    expect(result).toMatchObject({
      claimed: true,
      claimEpoch: 3,
      execution: { claimedBy: 'engineering-runner:new' },
    });
  });

  it('persists ownership and worker capability metadata atomically without changing status', async () => {
    const candidate = row({ claimEpoch: 5 });
    const harness = setup([[], [candidate]]);
    harness.setUpdateBase(candidate);

    const result = await harness.service.claimNext('engineering-runner:one', NOW);

    expect(harness.update).toHaveBeenCalledWith({
      where: { id: candidate.id },
      data: expect.objectContaining({
        status: 'DISPATCHED',
        claimedBy: 'engineering-runner:one',
        claimEpoch: 6,
        claimedAt: NOW,
        leaseExpiresAt: EXPECTED_LEASE,
        lastHeartbeatAt: NOW,
        assignment: expect.objectContaining({
          workerCapability: CAPABILITY_METADATA,
        }),
      }),
    });
    expect(result).toMatchObject({
      claimed: true,
      execution: {
        status: 'DISPATCHED',
        claimedBy: 'engineering-runner:one',
        claimEpoch: 6,
      },
      assignment: { workerCapability: CAPABILITY_METADATA },
    });
  });
});
