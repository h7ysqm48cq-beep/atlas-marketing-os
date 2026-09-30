import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { FileOwnershipStore } from '../stores/file-ownership.store';

type SupervisorFileLockRecord = {
  path: string;
  taskId: string;
  acquiredAt: Date;
};

type SupervisorFileLockDelegate = {
  findUnique(args: {
    where: { path: string };
  }): Promise<SupervisorFileLockRecord | null>;
  findMany(args: {
    where: { path: { in: string[] } };
  }): Promise<SupervisorFileLockRecord[]>;
  createMany(args: {
    data: Array<{ path: string; taskId: string }>;
  }): Promise<{ count: number }>;
  deleteMany(args: {
    where: { taskId: string };
  }): Promise<{ count: number }>;
};

type SupervisorTransactionClient = {
  supervisorFileLock: SupervisorFileLockDelegate;
};

type PrismaWithSupervisorFileLock = {
  supervisorFileLock: SupervisorFileLockDelegate;
  $transaction<T>(
    callback: (client: SupervisorTransactionClient) => Promise<T>,
  ): Promise<T>;
};

type PrismaUniqueError = {
  code?: unknown;
  meta?: {
    target?: unknown;
  };
};

function persistenceError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'supervisor_persistence_error',
  });
}

function uniqueTargetContains(error: unknown, field: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as PrismaUniqueError;
  if (candidate.code !== 'P2002') {
    return false;
  }

  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }

  return typeof target === 'string' && target.includes(field);
}

function fileOwnershipConflict(
  conflicts?: Array<{ path: string; owner: string }>,
): ConflictException {
  return new ConflictException({
    code: 'file_ownership_conflict',
    ...(conflicts && conflicts.length > 0 ? { conflicts } : {}),
  });
}

@Injectable()
export class PrismaFileOwnershipStore implements FileOwnershipStore {
  private readonly prisma: PrismaWithSupervisorFileLock;

  constructor(prisma: PrismaService) {
    this.prisma = prisma as unknown as PrismaWithSupervisorFileLock;
  }

  async findOwner(path: string): Promise<string | null> {
    return this.withPersistenceBoundary(async () => {
      const row = await this.prisma.supervisorFileLock.findUnique({
        where: { path },
      });
      return row?.taskId ?? null;
    });
  }

  async acquire(taskId: string, paths: string[]): Promise<void> {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.supervisorFileLock.findMany({
          where: { path: { in: uniquePaths } },
        });

        const conflicts = existing
          .filter((lock) => lock.taskId !== taskId)
          .map((lock) => ({ path: lock.path, owner: lock.taskId }));

        if (conflicts.length > 0) {
          throw fileOwnershipConflict(conflicts);
        }

        const ownedPaths = new Set(existing.map((lock) => lock.path));
        const missingPaths = uniquePaths.filter((path) => !ownedPaths.has(path));

        if (missingPaths.length === 0) {
          return;
        }

        await tx.supervisorFileLock.createMany({
          data: missingPaths.map((path) => ({ path, taskId })),
        });
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (uniqueTargetContains(error, 'path')) {
        throw fileOwnershipConflict();
      }
      throw persistenceError();
    }
  }

  async release(taskId: string): Promise<void> {
    await this.withPersistenceBoundary(async () => {
      await this.prisma.supervisorFileLock.deleteMany({
        where: { taskId },
      });
    });
  }

  private async withPersistenceBoundary<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw persistenceError();
    }
  }
}
