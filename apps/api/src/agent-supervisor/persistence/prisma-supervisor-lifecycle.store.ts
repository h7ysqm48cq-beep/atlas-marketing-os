import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type {
  SupervisorLifecycleStore,
  SupervisorLockMode,
} from '../stores/supervisor-lifecycle.store';
import {
  mapTaskRecord,
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
  supervisorTask: {
    update(args: {
      where: { id: string };
      data: TaskUpdateData;
    }): Promise<SupervisorTaskRecord>;
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
  meta?: { target?: unknown };
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

function isPathUniqueError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as PrismaUniqueError;
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  return (
    (Array.isArray(target) && target.includes('path')) ||
    (typeof target === 'string' && target.includes('path'))
  );
}

@Injectable()
export class PrismaSupervisorLifecycleStore
  implements SupervisorLifecycleStore
{
  private readonly prisma: PrismaWithTransaction;

  constructor(prisma: PrismaService) {
    this.prisma = prisma as unknown as PrismaWithTransaction;
  }

  async saveWithLocks(
    task: SupervisorTask,
    mode: SupervisorLockMode,
  ): Promise<SupervisorTask> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (mode === 'acquire') {
          await this.acquire(tx, task);
        } else {
          await tx.supervisorFileLock.deleteMany({
            where: { taskId: task.id },
          });
        }

        const row = await tx.supervisorTask.update({
          where: { id: task.id },
          data: taskUpdateData(task),
        });
        return mapTaskRecord(row);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (mode === 'acquire' && isPathUniqueError(error)) {
        throw conflict([]);
      }
      throw persistenceError();
    }
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
