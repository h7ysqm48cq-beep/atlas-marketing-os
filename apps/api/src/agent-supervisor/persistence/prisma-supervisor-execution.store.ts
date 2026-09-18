import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type {
  SupervisorExecution,
  SupervisorExecutionStatus,
} from '../execution/supervisor-execution.types';
import type {
  SupervisorExecutionClaimInput,
  SupervisorExecutionClaimStore,
  SupervisorExecutionHeartbeatInput,
  SupervisorExecutionHeartbeatStore,
  SupervisorExecutionReconciliationCandidate,
  SupervisorExecutionReconciliationQuery,
  SupervisorExecutionReconciliationStore,
  SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';
import {
  mapExecutionRecord,
  type SupervisorExecutionRecord,
} from './supervisor-persistence.mapper';

type SupervisorExecutionCreateArgs = {
  data: {
    id: string;
    taskId: string;
    workerRole: string;
    status: string;
    assignment: unknown;
    result: unknown;
    error: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    runnerId: string | null;
    claimEpoch: number;
    lastHeartbeatAt: Date | null;
    leaseExpiresAt: Date | null;
  };
};

type SupervisorExecutionUpdateArgs = {
  where: {
    id: string;
    taskId?: string;
    workerRole?: string;
    status?: string;
    claimEpoch?: number;
    runnerId?: string;
    lastHeartbeatAt?: Date;
    leaseExpiresAt?: Date;
  };
  data: Omit<SupervisorExecutionCreateArgs['data'], 'id' | 'createdAt'>;
};

type SupervisorExecutionHeartbeatUpdateArgs = {
  where: SupervisorExecutionUpdateArgs['where'];
  data: {
    lastHeartbeatAt: Date;
    leaseExpiresAt: Date;
  };
};

type SupervisorExecutionDelegate = {
  create(
    args: SupervisorExecutionCreateArgs,
  ): Promise<SupervisorExecutionRecord>;
  findUnique(args: {
    where: { id: string };
  }): Promise<SupervisorExecutionRecord | null>;
  findMany(args: {
    where: { taskId: string };
    orderBy: { createdAt: 'asc' };
  }): Promise<SupervisorExecutionRecord[]>;
  update(
    args: SupervisorExecutionUpdateArgs | SupervisorExecutionHeartbeatUpdateArgs,
  ): Promise<SupervisorExecutionRecord>;
};

type PrismaWithSupervisorExecution = {
  $transaction<T>(
    callback: (transaction: PrismaSupervisorExecutionTransaction) => Promise<T>,
  ): Promise<T>;
  supervisorExecution: SupervisorExecutionDelegate;
};

type PrismaSupervisorExecutionTransaction = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  supervisorExecution: SupervisorExecutionDelegate;
};

type PrismaUniqueError = {
  code?: unknown;
  meta?: {
    target?: unknown;
    modelName?: unknown;
    driverAdapterError?: {
      cause?: {
        originalMessage?: unknown;
        constraint?: {
          fields?: unknown;
        };
      };
    };
  };
};

function persistenceError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'supervisor_persistence_error',
  });
}

function activeExecutionConflict(taskId: string): ConflictException {
  return new ConflictException({
    code: 'active_execution_exists',
    taskId,
  });
}

function executionStateConflict(
  expectedStatus: SupervisorExecutionStatus,
): ConflictException {
  return new ConflictException({
    code: 'execution_state_conflict',
    expected: expectedStatus,
  });
}

function normalizeConstraintField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.replace(/^"|"$/g, '');
}

function isActiveExecutionUniqueError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as PrismaUniqueError;
  if (candidate.code !== 'P2002') {
    return false;
  }

  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === 'taskId';
  }

  if (
    typeof target === 'string' &&
    target === 'SupervisorExecution_one_active_per_task'
  ) {
    return true;
  }

  const adapterCause = candidate.meta?.driverAdapterError?.cause;
  const constraintFields = adapterCause?.constraint?.fields;
  if (Array.isArray(constraintFields)) {
    const normalizedFields = constraintFields
      .map(normalizeConstraintField)
      .filter((field): field is string => Boolean(field));
    if (normalizedFields.length === 1 && normalizedFields[0] === 'taskId') {
      return true;
    }
  }

  const originalMessage = adapterCause?.originalMessage;
  return (
    typeof originalMessage === 'string' &&
    originalMessage.includes('SupervisorExecution_one_active_per_task')
  );
}

function executionCreateData(
  execution: SupervisorExecution,
): SupervisorExecutionCreateArgs['data'] {
  return {
    id: execution.id,
    taskId: execution.taskId,
    workerRole: execution.workerRole,
    status: execution.status,
    assignment: structuredClone(execution.assignment),
    result:
      execution.result === null ? null : structuredClone(execution.result),
    error: execution.error,
    createdAt: new Date(execution.createdAt),
    startedAt: execution.startedAt ? new Date(execution.startedAt) : null,
    completedAt: execution.completedAt ? new Date(execution.completedAt) : null,
    runnerId: execution.runnerId,
    claimEpoch: execution.claimEpoch,
    lastHeartbeatAt: execution.lastHeartbeatAt
      ? new Date(execution.lastHeartbeatAt)
      : null,
    leaseExpiresAt: execution.leaseExpiresAt
      ? new Date(execution.leaseExpiresAt)
      : null,
  };
}

function executionUpdateData(
  execution: SupervisorExecution,
): SupervisorExecutionUpdateArgs['data'] {
  const data = executionCreateData(execution);
  return {
    taskId: data.taskId,
    workerRole: data.workerRole,
    status: data.status,
    assignment: data.assignment,
    result: data.result,
    error: data.error,
    startedAt: data.startedAt,
    completedAt: data.completedAt,
    runnerId: data.runnerId,
    claimEpoch: data.claimEpoch,
    lastHeartbeatAt: data.lastHeartbeatAt,
    leaseExpiresAt: data.leaseExpiresAt,
  };
}

@Injectable()
export class PrismaSupervisorExecutionStore
  implements
    SupervisorExecutionStore,
    SupervisorExecutionClaimStore,
    SupervisorExecutionHeartbeatStore,
    SupervisorExecutionReconciliationStore
{
  private readonly delegate: SupervisorExecutionDelegate;
  private readonly prisma: PrismaWithSupervisorExecution;

  constructor(prisma: PrismaService) {
    this.prisma = prisma as unknown as PrismaWithSupervisorExecution;
    this.delegate = this.prisma.supervisorExecution;
  }

  async listByTask(taskId: string): Promise<SupervisorExecution[]> {
    return this.withPersistenceBoundary(taskId, async () => {
      const rows = await this.delegate.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapExecutionRecord);
    });
  }

  async get(id: string): Promise<SupervisorExecution | null> {
    return this.withPersistenceBoundary(null, async () => {
      const row = await this.delegate.findUnique({ where: { id } });
      return row ? mapExecutionRecord(row) : null;
    });
  }

  async create(execution: SupervisorExecution): Promise<SupervisorExecution> {
    return this.withPersistenceBoundary(execution.taskId, async () => {
      const row = await this.delegate.create({
        data: executionCreateData(execution),
      });
      return mapExecutionRecord(row);
    });
  }

  async save(execution: SupervisorExecution): Promise<SupervisorExecution> {
    return this.withPersistenceBoundary(execution.taskId, async () => {
      const row = await this.delegate.update({
        where: { id: execution.id },
        data: executionUpdateData(execution),
      });
      return mapExecutionRecord(row);
    });
  }

  async saveIfStatus(
    execution: SupervisorExecution,
    expectedStatus: SupervisorExecutionStatus,
  ): Promise<SupervisorExecution> {
    try {
      const row = await this.delegate.update({
        where: { id: execution.id, status: expectedStatus },
        data: executionUpdateData(execution),
      });
      return mapExecutionRecord(row);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: unknown }).code === 'P2025'
      ) {
        throw executionStateConflict(expectedStatus);
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw persistenceError();
    }
  }

  async claimNext(
    input: SupervisorExecutionClaimInput,
  ): Promise<SupervisorExecution | null> {
    const executionPurpose = input.executionPurpose ?? 'IMPLEMENTATION';
    const requiredTaskStatus =
      executionPurpose === 'INDEPENDENT_VERIFICATION'
        ? 'VERIFYING'
        : 'WORKING';
    const requireFrozenBaseSha = input.requireFrozenBaseSha === true;
    return this.withPersistenceBoundary(null, async () =>
      this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<SupervisorExecutionRecord[]>`
          SELECT e.*
          FROM "SupervisorExecution" AS e
          JOIN "SupervisorTask" AS t
            ON t."id" = e."taskId"
          WHERE e."status" = ${'QUEUED'}
            AND t."status" = ${requiredTaskStatus}
            AND COALESCE(
              e."assignment"->>'executionPurpose',
              'IMPLEMENTATION'
            ) = ${executionPurpose}
            AND (
              ${requireFrozenBaseSha} = false
              OR e."assignment"->>'frozenBaseSha' ~ '^[0-9a-fA-F]{40}$'
            )
            AND e."workerRole" = ${input.workerRole}
          ORDER BY e."createdAt" ASC, e."id" ASC
          FOR UPDATE OF e, t SKIP LOCKED
          LIMIT 1
        `;
        const selected = rows[0];
        if (!selected) {
          return null;
        }

        const mapped = mapExecutionRecord(selected);
        const nextClaimEpoch = mapped.claimEpoch + 1;
        const assignment = {
          ...mapped.assignment,
          claimEpoch: nextClaimEpoch,
          runnerId: input.runnerId,
          leaseId: input.leaseId,
        };
        delete assignment.workerCapability;

        const claimed: SupervisorExecution = {
          ...mapped,
          status: 'RUNNING',
          runnerId: input.runnerId,
          claimEpoch: nextClaimEpoch,
          startedAt: new Date(input.now),
          lastHeartbeatAt: new Date(input.now),
          leaseExpiresAt: new Date(input.leaseExpiresAt),
          result: null,
          error: null,
          completedAt: null,
          assignment,
        };

        try {
          const row = await transaction.supervisorExecution.update({
            where: { id: mapped.id, status: 'QUEUED' },
            data: executionUpdateData(claimed),
          });
          return mapExecutionRecord(row);
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            (error as { code?: unknown }).code === 'P2025'
          ) {
            return null;
          }
          throw error;
        }
      }),
    );
  }

  heartbeat = async (
    input: SupervisorExecutionHeartbeatInput,
  ): Promise<SupervisorExecution | null> => {
    return this.withPersistenceBoundary(null, async () =>
      this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<SupervisorExecutionRecord[]>`
          SELECT *
          FROM "SupervisorExecution"
          WHERE "id" = ${input.executionId}
            AND "taskId" = ${input.taskId}
            AND "workerRole" = ${input.workerRole}
            AND "status" = 'RUNNING'
            AND "claimEpoch" = ${input.claimEpoch}
            AND "runnerId" = ${input.runnerId}
            AND "leaseExpiresAt" > ${input.now}
          FOR UPDATE
          LIMIT 1
        `;
        const selected = rows[0];
        if (!selected) {
          return null;
        }

        const current = mapExecutionRecord(selected);
        if (
          current.assignment.claimEpoch !== input.claimEpoch ||
          current.assignment.runnerId !== input.runnerId ||
          current.assignment.leaseId !== input.leaseId ||
          !current.lastHeartbeatAt ||
          !current.leaseExpiresAt ||
          input.now.getTime() <= current.lastHeartbeatAt.getTime() ||
          input.now.getTime() >= current.leaseExpiresAt.getTime() ||
          input.leaseExpiresAt.getTime() <= current.leaseExpiresAt.getTime() ||
          input.leaseExpiresAt.getTime() <= input.now.getTime()
        ) {
          return null;
        }

        try {
          const row = await transaction.supervisorExecution.update({
            where: {
              id: current.id,
              taskId: input.taskId,
              workerRole: input.workerRole,
              status: 'RUNNING',
              claimEpoch: input.claimEpoch,
              runnerId: input.runnerId,
              lastHeartbeatAt: current.lastHeartbeatAt,
              leaseExpiresAt: current.leaseExpiresAt,
            },
            data: {
              lastHeartbeatAt: new Date(input.now),
              leaseExpiresAt: new Date(input.leaseExpiresAt),
            },
          });
          return mapExecutionRecord(row);
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            (error as { code?: unknown }).code === 'P2025'
          ) {
            return null;
          }
          throw error;
        }
      }),
    );
  };

  async findReconciliationCandidates(
    input: SupervisorExecutionReconciliationQuery,
  ): Promise<SupervisorExecutionReconciliationCandidate[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new BadRequestException({
        code: 'reconciliation_batch_limit_invalid',
      });
    }

    return this.withPersistenceBoundary(null, async () =>
      this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<
          Array<{
            executionId: string;
            taskId: string;
            status: 'QUEUED' | 'DISPATCHED' | 'RUNNING';
            kind: SupervisorExecutionReconciliationCandidate['kind'];
            claimEpoch: number;
            runnerId: string | null;
            createdAt: Date;
            leaseExpiresAt: Date | null;
          }>
        >`
          SELECT
            e."id" AS "executionId",
            e."taskId",
            e."status",
            CASE
              WHEN e."status" = 'QUEUED' THEN 'QUEUED_TIMEOUT'
              WHEN e."status" = 'DISPATCHED' THEN 'LEGACY_DISPATCHED_TIMEOUT'
              ELSE 'RUNNING_LEASE_EXPIRED'
            END AS "kind",
            e."claimEpoch",
            e."runnerId",
            e."createdAt",
            e."leaseExpiresAt"
          FROM "SupervisorExecution" AS e
          WHERE (
            e."status" = 'QUEUED'
            AND e."createdAt" <= ${input.queuedBefore}
          ) OR (
            e."status" = 'DISPATCHED'
            AND e."createdAt" <= ${input.queuedBefore}
          ) OR (
            e."status" = 'RUNNING'
            AND e."leaseExpiresAt" <= ${input.now}
          )
          ORDER BY e."createdAt" ASC, e."id" ASC
          LIMIT ${input.limit}
        `;

        return rows.map((row) => ({
          executionId: row.executionId,
          taskId: row.taskId,
          status: row.status,
          kind: row.kind,
          claimEpoch: row.claimEpoch,
          runnerId: row.runnerId,
          createdAt: new Date(row.createdAt),
          leaseExpiresAt: row.leaseExpiresAt
            ? new Date(row.leaseExpiresAt)
            : null,
        }));
      }),
    );
  }

  private async withPersistenceBoundary<T>(
    taskId: string | null,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (taskId && isActiveExecutionUniqueError(error)) {
        throw activeExecutionConflict(taskId);
      }
      throw persistenceError();
    }
  }
}
