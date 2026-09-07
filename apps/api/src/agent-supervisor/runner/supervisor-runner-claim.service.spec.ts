import { ConflictException, Logger } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';
import { SupervisorRunnerClaimService } from './supervisor-runner-claim.service';

const NOW = new Date('2026-09-07T08:00:00.000Z');
const RUNNER_ID = 'engineering-runner:11111111-1111-4111-8111-111111111111';
const TOKEN = 'secret-capability-token';

function execution(
  overrides: Partial<SupervisorExecution> = {},
): SupervisorExecution {
  const id =
    overrides.id ??
    'ATLAS-EXEC-20260907-11111111-1111-4111-8111-111111111111';
  const taskId =
    overrides.taskId ??
    'ATLAS-20260907-11111111-1111-4111-8111-111111111111';
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
      runnerEligibility: 'A1_SYNTHETIC',
      objective: 'Validate atomic runner claim',
      allowedPaths: ['apps/api/src/agent-supervisor/runner/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
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
    createdAt: new Date('2026-09-07T07:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function queryText(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  return strings.join('?').replace(/\s+/gu, ' ').trim();
}

function harness(options: {
  sameRunner?: SupervisorExecution[];
  candidates?: SupervisorExecution[];
} = {}) {
  const sameRunner = options.sameRunner ?? [];
  const candidates = options.candidates ?? [];
  const rows = new Map(
    [...sameRunner, ...candidates].map((row) => [row.id, row]),
  );
  const rawResults: SupervisorExecution[][] = [sameRunner, candidates];
  const tx = {
    $queryRaw: jest.fn(async () => rawResults.shift() ?? []),
    supervisorExecution: {
      update: jest.fn(async (args: { where: { id: string }; data: object }) => ({
        ...rows.get(args.where.id),
        ...args.data,
      })),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const capability = {
    issue: jest.fn(() => ({
      token: TOKEN,
      metadata: {
        version: 2 as const,
        assignmentDigest: 'a'.repeat(64),
        allowedOperations: [
          'read_assignment',
          'mark_running',
          'complete',
          'fail',
          'cancel',
        ] as const,
        issuedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      },
    })),
  };
  const service = new SupervisorRunnerClaimService(
    prisma as unknown as PrismaService,
    capability as unknown as SupervisorWorkerCapabilityService,
  );

  return { service, prisma, tx, capability };
}

describe('SupervisorRunnerClaimService', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('claims the oldest eligible A1 synthetic implementation dispatch with a parameterized SKIP LOCKED query', async () => {
    const candidate = execution();
    const { service, prisma, tx, capability } = harness({
      candidates: [candidate],
    });

    await expect(service.claimNext(RUNNER_ID, NOW)).resolves.toMatchObject({
      claimed: true,
      execution: {
        id: candidate.id,
        status: 'DISPATCHED',
        claimedBy: RUNNER_ID,
        claimEpoch: 1,
      },
      claimEpoch: 1,
      leaseExpiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
      capability: TOKEN,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);

    const sameRunnerSql = queryText(tx.$queryRaw.mock.calls[0]);
    expect(sameRunnerSql).toContain('"claimedBy" = ?');
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([RUNNER_ID]);
    expect(sameRunnerSql).not.toContain(RUNNER_ID);

    const candidateSql = queryText(tx.$queryRaw.mock.calls[1]);
    expect(candidateSql).toContain(
      '"status" IN (\'DISPATCHED\', \'RUNNING\')',
    );
    expect(candidateSql).toContain('"claimedBy" IS NULL');
    expect(candidateSql).toContain('"leaseExpiresAt" <= ?');
    expect(candidateSql).toContain(
      '"assignment"->>\'executionPurpose\' = \'IMPLEMENTATION\'',
    );
    expect(candidateSql).toContain(
      '"assignment"->>\'runnerEligibility\' = \'A1_SYNTHETIC\'',
    );
    expect(candidateSql).toContain('ORDER BY "createdAt" ASC');
    expect(candidateSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(candidateSql).toContain('LIMIT 1');
    expect(candidateSql).toContain('"status" = \'RUNNING\'');
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([NOW, NOW]);
    expect(candidateSql).not.toContain(NOW.toISOString());

    expect(capability.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: candidate.id,
        status: 'DISPATCHED',
        claimedBy: RUNNER_ID,
        claimEpoch: 1,
        claimedAt: NOW,
        lastHeartbeatAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      }),
      { now: NOW },
    );
    expect(tx.supervisorExecution.update).toHaveBeenCalledWith({
      where: { id: candidate.id },
      data: expect.objectContaining({
        status: 'DISPATCHED',
        claimedBy: RUNNER_ID,
        claimEpoch: 1,
        claimedAt: NOW,
        lastHeartbeatAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
        assignment: expect.objectContaining({
          workerCapability: expect.objectContaining({ version: 2 }),
        }),
      }),
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.claim.succeeded',
        executionId: candidate.id,
        runnerId: RUNNER_ID,
        claimEpoch: 1,
      }),
    );
  });

  it('returns empty when the database reports no eligible dispatch', async () => {
    const { service, tx, capability } = harness();

    await expect(service.claimNext(RUNNER_ID, NOW)).resolves.toEqual({
      claimed: false,
    });

    expect(tx.supervisorExecution.update).not.toHaveBeenCalled();
    expect(capability.issue).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.claim.empty',
        runnerId: RUNNER_ID,
      }),
    );
  });

  it('rejects a same-runner live DISPATCHED execution before unrelated candidate selection', async () => {
    const held = execution({
      claimedBy: RUNNER_ID,
      claimEpoch: 3,
      claimedAt: new Date(NOW.getTime() - 30_000),
      lastHeartbeatAt: new Date(NOW.getTime() - 30_000),
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    });
    const unrelated = execution({
      id: 'ATLAS-EXEC-20260907-22222222-2222-4222-8222-222222222222',
      taskId: 'ATLAS-20260907-22222222-2222-4222-8222-222222222222',
    });
    const { service, tx } = harness({
      sameRunner: [held],
      candidates: [unrelated],
    });

    await expect(service.claimNext(RUNNER_ID, NOW)).rejects.toMatchObject({
      status: 409,
      response: { code: 'runner_already_holds_active_execution' },
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.supervisorExecution.update).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.claim.rejected',
        reason: 'runner_already_holds_active_execution',
        executionId: held.id,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.fenced',
        reason: 'runner_already_holds_active_execution',
        executionId: held.id,
      }),
    );
  });

  it('reclaims a same-runner RUNNING execution after its lease expires', async () => {
    const running = execution({
      id: 'ATLAS-EXEC-20260907-33333333-3333-4333-8333-333333333333',
      taskId: 'ATLAS-20260907-33333333-3333-4333-8333-333333333333',
      status: 'RUNNING',
      claimedBy: RUNNER_ID,
      claimEpoch: 7,
      leaseExpiresAt: new Date(NOW.getTime() - 60_000),
    });
    const { service, tx } = harness({ sameRunner: [running] });

    await expect(service.claimNext(RUNNER_ID, NOW)).resolves.toMatchObject({
      claimed: true,
      execution: {
        id: running.id,
        status: 'DISPATCHED',
        claimedBy: RUNNER_ID,
        claimEpoch: 8,
      },
      claimEpoch: 8,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.supervisorExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: running.id },
        data: expect.objectContaining({
          status: 'DISPATCHED',
          claimEpoch: 8,
        }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.claim.reclaimed',
        executionId: running.id,
        claimEpoch: 8,
      }),
    );
  });

  it('reclaims the same expired DISPATCHED row and increments epoch exactly once', async () => {
    const held = execution({
      claimedBy: RUNNER_ID,
      claimEpoch: 9,
      claimedAt: new Date(NOW.getTime() - 240_000),
      lastHeartbeatAt: new Date(NOW.getTime() - 240_000),
      leaseExpiresAt: new Date(NOW.getTime() - 1),
    });
    const unrelated = execution({
      id: 'ATLAS-EXEC-20260907-44444444-4444-4444-8444-444444444444',
      taskId: 'ATLAS-20260907-44444444-4444-4444-8444-444444444444',
    });
    const { service, tx } = harness({
      sameRunner: [held],
      candidates: [unrelated],
    });

    await expect(service.claimNext(RUNNER_ID, NOW)).resolves.toMatchObject({
      claimed: true,
      execution: {
        id: held.id,
        status: 'DISPATCHED',
        claimedBy: RUNNER_ID,
        claimEpoch: 10,
      },
      claimEpoch: 10,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.supervisorExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: held.id },
        data: expect.objectContaining({
          status: 'DISPATCHED',
          claimEpoch: 10,
        }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.claim.reclaimed',
        executionId: held.id,
        claimEpoch: 10,
      }),
    );
  });

  it('persists capability metadata in the claim transaction and returns no token when commit fails', async () => {
    const candidate = execution();
    const { service, prisma, tx, capability } = harness({
      candidates: [candidate],
    });
    prisma.$transaction.mockImplementationOnce(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        await callback(tx);
        throw new Error('commit_failed');
      },
    );

    await expect(service.claimNext(RUNNER_ID, NOW)).rejects.toThrow(
      'commit_failed',
    );

    expect(capability.issue).toHaveBeenCalledTimes(1);
    expect(tx.supervisorExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignment: expect.objectContaining({
            workerCapability: expect.objectContaining({ version: 2 }),
          }),
        }),
      }),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'runner.claim.succeeded' }),
    );
  });

  it('never includes capability secrets in structured claim logs', async () => {
    const { service } = harness({ candidates: [execution()] });

    await service.claimNext(RUNNER_ID, NOW);

    const messages = JSON.stringify([
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]);
    expect(messages).toContain('runner.claim.succeeded');
    expect(messages).not.toContain(TOKEN);
    expect(messages).not.toContain('signature');
    expect(messages).not.toContain('authorization');
  });
});
