import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { SupervisorExecutionReconciliationCandidate } from '../stores/supervisor-execution.store';
import type {
  SupervisorLifecycleStore,
  ExistingCandidateAtomicAdmission,
  SupervisorLockMode,
  SupervisorExecutionRecoveryInput,
  SupervisorExecutionReconciliationInput,
  SupervisorExecutionOwnerAbortRecoveryInput,
  SupervisorExecutionRecoveryResult,
  SupervisorExecutionRecoveryStore,
} from '../stores/supervisor-lifecycle.store';
import {
  mapExecutionRecord,
  mapTaskRecord,
  type SupervisorExecutionRecord,
  type SupervisorTaskRecord,
} from './supervisor-persistence.mapper';

type TaskUpdateData = {
  objective: string;
  owner: string;
  status: string;
  allowedPaths: string[];
  forbiddenActions: string[];
  dependsOn: string[];
  acceptance: string[];
  evidence: unknown | null;
  blockingReason: string | null;
  failureReason: string | null;
  updatedAt: Date;
};

type TransactionClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  supervisorExecution: {
    create(args: { data: Record<string, unknown> }): Promise<SupervisorExecutionRecord>;
    findUnique(args: {
      where: { id: string };
    }): Promise<SupervisorExecutionRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  supervisorTask: {

    updateMany(args: {
      where: Record<string, unknown>;
      data: TaskUpdateData;
    }): Promise<{ count: number }>;

    findUnique(args: {
      where: { id: string };
    }): Promise<SupervisorTaskRecord | null>;
  };
  supervisorFileLock: {
    findMany(args: {
      where: { path: { in: string[] } };
    }): Promise<Array<{ path: string; taskId: string }>>;
    createMany(args: {
      data: Array<{ path: string; taskId: string }>;
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { taskId: string };
    }): Promise<{ count: number }>;
  };
};

type PrismaWithTransaction = {
  $transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
};

type PrismaUniqueError = {
  code?: unknown;
  meta?: {
    target?: unknown;
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

function conflict(
  conflicts: Array<{ path: string; owner: string }>,
): ConflictException {
  return new ConflictException({
    code: 'file_ownership_conflict',
    conflicts,
  });
}

function taskUpdateData(task: SupervisorTask): TaskUpdateData {
  return {
    objective: task.objective,
    owner: task.owner,
    status: task.status,
    allowedPaths: [...task.allowedPaths],
    forbiddenActions: [...task.forbiddenActions],
    dependsOn: [...task.dependsOn],
    acceptance: [...task.acceptance],
    evidence: task.evidence === null ? null : structuredClone(task.evidence),
    blockingReason: task.blockingReason,
    failureReason: task.failureReason,
    updatedAt: new Date(task.updatedAt),
  };
}

function executionUpdateData(execution: SupervisorExecution): Record<string, unknown> {
  return {
    taskId: execution.taskId,
    workerRole: execution.workerRole,
    status: execution.status,
    assignment: structuredClone(execution.assignment),
    result: execution.result === null ? null : structuredClone(execution.result),
    error: execution.error,
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

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function isRecoveryKindForStatus(
  candidate: SupervisorExecutionReconciliationCandidate,
): boolean {
  return (
    (candidate.status === 'QUEUED' && candidate.kind === 'QUEUED_TIMEOUT') ||
    (candidate.status === 'DISPATCHED' &&
      candidate.kind === 'LEGACY_DISPATCHED_TIMEOUT') ||
    (candidate.status === 'RUNNING' &&
      candidate.kind === 'RUNNING_LEASE_EXPIRED')
  );
}

function recoveryReason(
  kind: SupervisorExecutionReconciliationCandidate['kind'],
): string {
  switch (kind) {
    case 'QUEUED_TIMEOUT':
      return 'supervisor_execution_queued_timeout';
    case 'LEGACY_DISPATCHED_TIMEOUT':
      return 'supervisor_execution_legacy_dispatched_timeout';
    case 'RUNNING_LEASE_EXPIRED':
      return 'supervisor_execution_lease_expired';
  }
}

function normalizeConstraintField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.replace(/^"|"$/g, '');
}

function isPathUniqueError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as PrismaUniqueError;
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (
    (Array.isArray(target) && target.includes('path')) ||
    (typeof target === 'string' && target.includes('path'))
  ) {
    return true;
  }

  const adapterCause = candidate.meta?.driverAdapterError?.cause;
  const constraintFields = adapterCause?.constraint?.fields;
  if (Array.isArray(constraintFields)) {
    const normalizedFields = constraintFields
      .map(normalizeConstraintField)
      .filter((field): field is string => Boolean(field));
    if (normalizedFields.includes('path')) {
      return true;
    }
  }

  const originalMessage = adapterCause?.originalMessage;
  return (
    typeof originalMessage === 'string' &&
    originalMessage.includes('SupervisorFileLock') &&
    originalMessage.includes('path')
  );
}

function isOwnerAbortInput(
  input: SupervisorExecutionRecoveryInput,
): input is SupervisorExecutionOwnerAbortRecoveryInput {
  return 'source' in input && input.source === 'HUMAN_OWNER_ABORT';
}

@Injectable()
export class PrismaSupervisorLifecycleStore
  implements SupervisorLifecycleStore, SupervisorExecutionRecoveryStore, ExistingCandidateAtomicAdmission
{
  private readonly prisma: PrismaWithTransaction;

  constructor(prisma: PrismaService) {
    this.prisma = prisma as unknown as PrismaWithTransaction;
  }

  async saveWithLocksIfUnchanged(
    task: SupervisorTask,
    mode: SupervisorLockMode,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const updated =
            await tx.supervisorTask.updateMany({
              where: {
                id: task.id,
                updatedAt: new Date(
                  expectedUpdatedAt,
                ),
              },
              data: taskUpdateData(task),
            });

          /*
           * Version check must happen before lock mutations.
           * A stale writer exits without touching ownership.
           */
          if (updated.count === 0) {
            return null;
          }

          if (mode === 'acquire') {
            await this.acquire(tx, task);
          } else {
            await tx.supervisorFileLock.deleteMany({
              where: { taskId: task.id },
            });
          }

          const row =
            await tx.supervisorTask.findUnique({
              where: { id: task.id },
            });

          if (!row) {
            throw persistenceError();
          }

          return mapTaskRecord(row);
        },
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (
        mode === 'acquire' &&
        isPathUniqueError(error)
      ) {
        throw conflict([]);
      }

      throw persistenceError();
    }
  }

  async admitExistingCandidateAndQueue(
    currentTask: SupervisorTask,
    execution: SupervisorExecution,
  ): Promise<{ task: SupervisorTask; execution: SupervisorExecution } | null> {
    if (!['DRAFT', 'BLOCKED'].includes(currentTask.status) ||
        currentTask.evidence !== null || execution.taskId !== currentTask.id ||
        execution.status !== 'QUEUED' ||
        execution.assignment.verificationMode !== 'EXISTING_CANDIDATE' ||
        execution.assignment.executionPurpose !== 'INDEPENDENT_VERIFICATION' ||
        execution.workerRole !== 'verifier' ||
        execution.assignment.workerRole !== 'verifier' ||
        JSON.stringify([...execution.assignment.allowedPaths].sort()) !==
        JSON.stringify([...currentTask.allowedPaths].sort())) {
      throw new ConflictException({ code: 'existing_candidate_atomic_input_invalid' });
    }
    try {
      return await this.prisma.$transaction(async tx => {
        const history = await tx.$queryRaw<Array<{ id: string; status: string; purpose: string }>>`
          SELECT "id", "status",
            COALESCE("assignment"->>'executionPurpose', 'IMPLEMENTATION') AS purpose
          FROM "SupervisorExecution"
          WHERE "taskId" = ${currentTask.id}
          ORDER BY "id"
          FOR UPDATE
        `;
        if (currentTask.status === 'DRAFT' ? history.length !== 0 :
            !history.some(row => row.status === 'FAILED' && row.purpose === 'IMPLEMENTATION')) {
          throw new ConflictException({ code: 'existing_candidate_history_changed' });
        }
        if (history.some(row => ['QUEUED','DISPATCHED','RUNNING'].includes(row.status))) {
          throw new ConflictException({ code: 'active_execution_exists', taskId: currentTask.id });
        }
        const nextTask: SupervisorTask = {
          ...currentTask, status: 'VERIFYING', blockingReason: null,
          failureReason: null,
          updatedAt: new Date(Math.max(Date.now(), currentTask.updatedAt.getTime() + 1)),
        };
        const updated = await tx.supervisorTask.updateMany({
          where: {
            id: currentTask.id, status: currentTask.status,
            updatedAt: new Date(currentTask.updatedAt),
          },
          data: taskUpdateData(nextTask),
        });
        if (updated.count !== 1) return null;
        await this.acquire(tx, nextTask);
        const row = await tx.supervisorExecution.create({
          data: {
            id: execution.id, taskId: execution.taskId,
            workerRole: execution.workerRole, status: execution.status,
            assignment: structuredClone(execution.assignment),
            result: null, error: null, createdAt: new Date(execution.createdAt),
            startedAt: null, completedAt: null, runnerId: null, claimEpoch: 0,
            lastHeartbeatAt: null, leaseExpiresAt: null,
          },
        });
        const persistedTask = await tx.supervisorTask.findUnique({
          where: { id: currentTask.id },
        });
        if (!persistedTask) throw persistenceError();
        return {
          task: mapTaskRecord(persistedTask),
          execution: mapExecutionRecord(row),
        };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isPathUniqueError(error)) throw conflict([]);
      throw persistenceError();
    }
  }

  async recoverExecutionAndBlockTask(
    input: SupervisorExecutionRecoveryInput,
  ): Promise<SupervisorExecutionRecoveryResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) =>
        isOwnerAbortInput(input)
          ? this.recoverOwnerAbort(tx, input)
          : this.recoverReconciliation(tx, input),
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw persistenceError();
    }
  }

  private async recoverOwnerAbort(
    tx: TransactionClient,
    input: SupervisorExecutionOwnerAbortRecoveryInput,
  ): Promise<SupervisorExecutionRecoveryResult | null> {
    const taskRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "SupervisorTask"
      WHERE "id" = ${input.taskId}
        AND "status" = 'WORKING'
      FOR UPDATE
    `;
    if (taskRows.length !== 1) return null;

    const activeRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "SupervisorExecution"
      WHERE "taskId" = ${input.taskId}
        AND "status" IN ('QUEUED', 'DISPATCHED', 'RUNNING')
      ORDER BY "createdAt" ASC, "id" ASC
      FOR UPDATE
    `;
    if (activeRows.length !== 1) return null;

    const executionRow = await tx.supervisorExecution.findUnique({
      where: { id: activeRows[0].id },
    });
    const taskRow = await tx.supervisorTask.findUnique({
      where: { id: input.taskId },
    });
    if (!executionRow || !taskRow) return null;

    const currentExecution = mapExecutionRecord(executionRow);
    const currentTask = mapTaskRecord(taskRow);
    if (
      currentExecution.taskId !== input.taskId ||
      !['QUEUED', 'DISPATCHED', 'RUNNING'].includes(currentExecution.status) ||
      currentTask.id !== input.taskId ||
      currentTask.status !== 'WORKING' ||
      !input.reason.trim()
    ) {
      return null;
    }

    const reason = `supervisor_execution_owner_abort:${input.reason.trim()}`;
    const nextClaimEpoch = currentExecution.claimEpoch + 1;
    const assignment = { ...currentExecution.assignment };
    assignment.workerCapability = undefined;
    delete assignment.runnerId;
    delete assignment.leaseId;
    assignment.claimEpoch = nextClaimEpoch;

    const abortedExecution: SupervisorExecution = {
      ...currentExecution,
      status: 'CANCELLED',
      completedAt: new Date(input.now),
      error: reason,
      claimEpoch: nextClaimEpoch,
      runnerId: null,
      leaseExpiresAt: null,
      assignment,
    };
    const executionUpdate = await tx.supervisorExecution.updateMany({
      where: {
        id: currentExecution.id,
        taskId: currentExecution.taskId,
        status: currentExecution.status,
        claimEpoch: currentExecution.claimEpoch,
        runnerId: currentExecution.runnerId,
        leaseExpiresAt: currentExecution.leaseExpiresAt,
      },
      data: executionUpdateData(abortedExecution),
    });
    if (executionUpdate.count !== 1) throw persistenceError();

    const blockedTask: SupervisorTask = {
      ...currentTask,
      status: 'BLOCKED',
      blockingReason: reason,
      updatedAt: new Date(input.now),
    };
    const taskUpdate = await tx.supervisorTask.updateMany({
      where: {
        id: currentTask.id,
        status: 'WORKING',
      },
      data: taskUpdateData(blockedTask),
    });
    if (taskUpdate.count !== 1) throw persistenceError();

    await tx.supervisorFileLock.deleteMany({
      where: { taskId: input.taskId },
    });

    return {
      execution: abortedExecution,
      task: blockedTask,
    };
  }

  private async recoverReconciliation(
    tx: TransactionClient,
    input: SupervisorExecutionReconciliationInput,
  ): Promise<SupervisorExecutionRecoveryResult | null> {
    await tx.$queryRaw`
          SELECT "id"
          FROM "SupervisorExecution"
          WHERE "id" = ${input.candidate.executionId}
          FOR UPDATE
        `;
        await tx.$queryRaw`
          SELECT "id"
          FROM "SupervisorTask"
          WHERE "id" = ${input.candidate.taskId}
          FOR UPDATE
        `;

        const executionRow = await tx.supervisorExecution.findUnique({
          where: { id: input.candidate.executionId },
        });
        const taskRow = await tx.supervisorTask.findUnique({
          where: { id: input.candidate.taskId },
        });
        if (!executionRow || !taskRow) return null;

        const currentExecution = mapExecutionRecord(executionRow);
        const currentTask = mapTaskRecord(taskRow);
        const taskStatusSupportsRecovery =
          currentTask.status === 'WORKING' ||
          (currentTask.status === 'VERIFYING' &&
            currentExecution.assignment.executionPurpose ===
              'INDEPENDENT_VERIFICATION');
        const terminalParentAllowsExecutionCleanup =
          currentTask.status === 'APPROVED' ||
          currentTask.status === 'FAILED' ||
          (currentTask.status === 'BLOCKED' &&
            currentExecution.status === 'QUEUED');
        if (
          currentExecution.id !== input.candidate.executionId ||
          currentExecution.taskId !== input.candidate.taskId ||
          currentExecution.status !== input.candidate.status ||
          currentExecution.claimEpoch !== input.candidate.claimEpoch ||
          currentExecution.runnerId !== input.candidate.runnerId ||
          currentExecution.createdAt.getTime() !==
            input.candidate.createdAt.getTime() ||
          !sameDate(currentExecution.leaseExpiresAt, input.candidate.leaseExpiresAt) ||
          (!taskStatusSupportsRecovery &&
            !terminalParentAllowsExecutionCleanup) ||
          !isRecoveryKindForStatus(input.candidate) ||
          (input.candidate.status === 'RUNNING' &&
            (!currentExecution.leaseExpiresAt ||
              currentExecution.leaseExpiresAt.getTime() > input.now.getTime()))
        ) {
          return null;
        }

        const reason = recoveryReason(input.candidate.kind);
        const nextClaimEpoch = currentExecution.claimEpoch + 1;
        const assignment = { ...currentExecution.assignment };
        assignment.workerCapability = undefined;
        delete assignment.runnerId;
        delete assignment.leaseId;
        assignment.claimEpoch = nextClaimEpoch;

        const recoveredExecution: SupervisorExecution = {
          ...currentExecution,
          status: 'FAILED',
          completedAt: new Date(input.now),
          error: reason,
          claimEpoch: nextClaimEpoch,
          runnerId: null,
          leaseExpiresAt: null,
          assignment,
        };
        const executionUpdate = await tx.supervisorExecution.updateMany({
          where: {
            id: currentExecution.id,
            taskId: currentExecution.taskId,
            status: currentExecution.status,
            claimEpoch: currentExecution.claimEpoch,
            runnerId: currentExecution.runnerId,
            createdAt: currentExecution.createdAt,
            leaseExpiresAt: currentExecution.leaseExpiresAt,
          },
          data: executionUpdateData(recoveredExecution),
        });
        if (executionUpdate.count !== 1) throw persistenceError();

        if (terminalParentAllowsExecutionCleanup) {
          return {
            execution: recoveredExecution,
            task: currentTask,
          };
        }

        const blockedTask: SupervisorTask = {
          ...currentTask,
          status: 'BLOCKED',
          blockingReason: reason,
          updatedAt: new Date(input.now),
        };
        const taskUpdate = await tx.supervisorTask.updateMany({
          where: {
            id: currentTask.id,
            status: currentTask.status,
          },
          data: taskUpdateData(blockedTask),
        });
        if (taskUpdate.count !== 1) throw persistenceError();

        await tx.supervisorFileLock.deleteMany({
          where: { taskId: input.candidate.taskId },
        });

        return {
          execution: recoveredExecution,
          task: blockedTask,
        };
    }

  private async acquire(
    tx: TransactionClient,
    task: SupervisorTask,
  ): Promise<void> {
    const paths = Array.from(new Set(task.allowedPaths));
    if (paths.length === 0) return;

    const existing = await tx.supervisorFileLock.findMany({
      where: { path: { in: paths } },
    });
    const conflicts = existing
      .filter((lock) => lock.taskId !== task.id)
      .map((lock) => ({ path: lock.path, owner: lock.taskId }));
    if (conflicts.length > 0) {
      throw conflict(conflicts);
    }

    const owned = new Set(existing.map((lock) => lock.path));
    const missing = paths.filter((path) => !owned.has(path));
    if (missing.length > 0) {
      await tx.supervisorFileLock.createMany({
        data: missing.map((path) => ({ path, taskId: task.id })),
      });
    }
  }
}
