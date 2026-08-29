import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { SupervisorExecutionStore } from '../stores/supervisor-execution.store';
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
    result: unknown | null;
    error: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  };
};

type SupervisorExecutionUpdateArgs = {
  where: { id: string };
  data: Omit<SupervisorExecutionCreateArgs['data'], 'id' | 'createdAt'>;
};

type SupervisorExecutionDelegate = {
  create(args: SupervisorExecutionCreateArgs): Promise<SupervisorExecutionRecord>;
  findUnique(args: {
    where: { id: string };
  }): Promise<SupervisorExecutionRecord | null>;
  findMany(args: {
    where: { taskId: string };
    orderBy: { createdAt: 'asc' };
  }): Promise<SupervisorExecutionRecord[]>;
  update(args: SupervisorExecutionUpdateArgs): Promise<SupervisorExecutionRecord>;
};

type PrismaWithSupervisorExecution = {
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
    result: execution.result === null ? null : structuredClone(execution.result),
    error: execution.error,
    createdAt: new Date(execution.createdAt),
    startedAt: execution.startedAt ? new Date(execution.startedAt) : null,
    completedAt: execution.completedAt
      ? new Date(execution.completedAt)
      : null,
  };
}

function executionUpdateData(
  execution: SupervisorExecution,
): SupervisorExecutionUpdateArgs['data'] {
  const { id: _id, createdAt: _createdAt, ...data } =
    executionCreateData(execution);
  return data;
}

@Injectable()
export class PrismaSupervisorExecutionStore
  implements SupervisorExecutionStore
{
  private readonly delegate: SupervisorExecutionDelegate;

  constructor(prisma: PrismaService) {
    this.delegate = (
      prisma as unknown as PrismaWithSupervisorExecution
    ).supervisorExecution;
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