import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type {
  SupervisorExecution,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';
import {
  mapExecutionRecord,
  type SupervisorExecutionRecord,
} from '../persistence/supervisor-persistence.mapper';
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';

const LEASE_MS = 120_000;

export type ClaimNextResult =
  | { claimed: false }
  | {
      claimed: true;
      execution: SupervisorExecution;
      assignment: WorkerAssignmentEnvelope;
      claimEpoch: number;
      leaseExpiresAt: string;
      capability: string;
    };

type ClaimedResult = Extract<ClaimNextResult, { claimed: true }>;

type ClaimTransactionOutcome =
  | { result: { claimed: false } }
  | {
      result: ClaimedResult;
      event: 'runner.claim.succeeded' | 'runner.claim.reclaimed';
      reason: string | null;
      execution: SupervisorExecutionRecord;
    };

type RunnerTransaction = {
  $queryRaw<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  supervisorExecution: {
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SupervisorExecutionRecord>;
  };
};

type PrismaUniqueError = {
  code?: unknown;
  meta?: {
    target?: unknown;
    driverAdapterError?: {
      cause?: {
        originalMessage?: unknown;
      };
    };
  };
};

@Injectable()
export class SupervisorRunnerClaimService {
  private readonly logger = new Logger(SupervisorRunnerClaimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capability: SupervisorWorkerCapabilityService,
  ) {}

  async claimNext(runnerId: string, now: Date = new Date()): Promise<ClaimNextResult> {
    try {
      const outcome = await this.prisma.$transaction(async (prismaTx) => {
        const tx = prismaTx as unknown as RunnerTransaction;
        const ownedRows = await tx.$queryRaw<SupervisorExecutionRecord[]>`
          SELECT *
          FROM "SupervisorExecution"
          WHERE "claimedBy" = ${runnerId}
            AND "status" IN ('DISPATCHED', 'RUNNING')
          ORDER BY "createdAt" ASC
          FOR UPDATE
          LIMIT 1
        `;
        const owned = ownedRows[0] ?? null;

        if (owned) {
          if (
            owned.status === 'RUNNING' ||
            !owned.leaseExpiresAt ||
            owned.leaseExpiresAt.getTime() > now.getTime()
          ) {
            this.securityEvent('runner.claim.rejected', {
              reason: 'runner_already_holds_active_execution',
              runnerId,
              execution: owned,
              now,
            });
            this.securityEvent('runner.fenced', {
              reason: 'runner_already_holds_active_execution',
              runnerId,
              execution: owned,
              now,
            });
            throw this.activeExecutionConflict(runnerId, owned.id);
          }

          return this.allocateClaim(tx, owned, runnerId, now, true);
        }

        const candidates = await tx.$queryRaw<SupervisorExecutionRecord[]>`
          SELECT *
          FROM "SupervisorExecution"
          WHERE "status" = 'DISPATCHED'
            AND (
              "claimedBy" IS NULL
              OR "leaseExpiresAt" <= ${now}
            )
            AND "assignment"->>'executionPurpose' = 'IMPLEMENTATION'
            AND "assignment"->>'runnerEligibility' = 'A1_SYNTHETIC'
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;
        const candidate = candidates[0] ?? null;
        if (!candidate || !this.isEligibleCandidate(candidate, now)) {
          this.securityEvent('runner.claim.empty', {
            reason: 'no_eligible_execution',
            runnerId,
            now,
          });
          return { result: { claimed: false } } satisfies ClaimTransactionOutcome;
        }

        return this.allocateClaim(
          tx,
          candidate,
          runnerId,
          now,
          candidate.claimedBy !== null,
        );
      });

      if ('event' in outcome) {
        this.securityEvent(outcome.event, {
          reason: outcome.reason,
          runnerId,
          execution: outcome.execution,
          now,
        });
      }
      return outcome.result;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (this.isRunnerUniqueConflict(error)) {
        this.securityEvent('runner.claim.rejected', {
          reason: 'runner_already_holds_active_execution',
          runnerId,
          now,
        });
        throw this.activeExecutionConflict(runnerId);
      }
      throw error;
    }
  }

  private async allocateClaim(
    tx: RunnerTransaction,
    row: SupervisorExecutionRecord,
    runnerId: string,
    now: Date,
    reclaimed: boolean,
  ): Promise<ClaimTransactionOutcome> {
    const current = mapExecutionRecord(row);
    const claimEpoch = current.claimEpoch + 1;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed: SupervisorExecution = {
      ...current,
      assignment: structuredClone(current.assignment),
      status: 'DISPATCHED',
      claimedBy: runnerId,
      claimEpoch,
      claimedAt: new Date(now),
      leaseExpiresAt,
      lastHeartbeatAt: new Date(now),
    };
    const issued = this.capability.issue(claimed, { now });
    claimed.assignment.workerCapability = structuredClone(issued.metadata);

    const persistedRecord = await tx.supervisorExecution.update({
      where: { id: claimed.id },
      data: {
        status: claimed.status,
        claimedBy: claimed.claimedBy,
        claimEpoch: claimed.claimEpoch,
        claimedAt: claimed.claimedAt,
        leaseExpiresAt: claimed.leaseExpiresAt,
        lastHeartbeatAt: claimed.lastHeartbeatAt,
        assignment: structuredClone(claimed.assignment),
      },
    });
    const execution = mapExecutionRecord(persistedRecord);

    return {
      result: {
        claimed: true,
        execution,
        assignment: structuredClone(execution.assignment),
        claimEpoch,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        capability: issued.token,
      },
      event: reclaimed ? 'runner.claim.reclaimed' : 'runner.claim.succeeded',
      reason: reclaimed ? 'expired_claim_recovered' : null,
      execution: persistedRecord,
    };
  }

  private isEligibleCandidate(
    row: SupervisorExecutionRecord,
    now: Date,
  ): boolean {
    if (row.status !== 'DISPATCHED') return false;
    if (
      row.claimedBy !== null &&
      (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() > now.getTime())
    ) {
      return false;
    }
    if (
      !row.assignment ||
      typeof row.assignment !== 'object' ||
      Array.isArray(row.assignment)
    ) {
      return false;
    }
    const assignment = row.assignment as {
      executionPurpose?: unknown;
      runnerEligibility?: unknown;
    };
    return (
      assignment.executionPurpose === 'IMPLEMENTATION' &&
      assignment.runnerEligibility === 'A1_SYNTHETIC'
    );
  }

  private activeExecutionConflict(
    runnerId: string,
    executionId?: string,
  ): ConflictException {
    return new ConflictException({
      code: 'runner_already_holds_active_execution',
      runnerId,
      ...(executionId ? { executionId } : {}),
    });
  }

  private isRunnerUniqueConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as PrismaUniqueError;
    if (candidate.code !== 'P2002') return false;
    const target = candidate.meta?.target;
    if (Array.isArray(target) && target.includes('claimedBy')) return true;
    if (
      typeof target === 'string' &&
      target === 'SupervisorExecution_one_active_per_runner'
    ) {
      return true;
    }
    const originalMessage =
      candidate.meta?.driverAdapterError?.cause?.originalMessage;
    return (
      typeof originalMessage === 'string' &&
      originalMessage.includes('SupervisorExecution_one_active_per_runner')
    );
  }

  private securityEvent(
    event:
      | 'runner.claim.succeeded'
      | 'runner.claim.empty'
      | 'runner.claim.reclaimed'
      | 'runner.claim.rejected'
      | 'runner.fenced',
    input: {
      reason: string | null;
      runnerId: string;
      now: Date;
      execution?: SupervisorExecutionRecord;
    },
  ): void {
    const executionPurpose =
      input.execution &&
      input.execution.assignment &&
      typeof input.execution.assignment === 'object' &&
      !Array.isArray(input.execution.assignment)
        ? (input.execution.assignment as { executionPurpose?: unknown })
            .executionPurpose
        : undefined;
    this.logger.log({
      event,
      reason: input.reason,
      taskId: input.execution?.taskId,
      executionId: input.execution?.id,
      runnerId: input.runnerId,
      claimEpoch: input.execution?.claimEpoch,
      status: input.execution?.status,
      executionPurpose:
        typeof executionPurpose === 'string' ? executionPurpose : undefined,
      claimedAt: input.execution?.claimedAt?.toISOString(),
      leaseExpiresAt: input.execution?.leaseExpiresAt?.toISOString(),
      timestamp: input.now.toISOString(),
    });
  }
}
