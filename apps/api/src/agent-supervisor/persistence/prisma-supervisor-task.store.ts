import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorTaskStore } from '../stores/supervisor-task.store';
import {
  mapTaskRecord,
  type SupervisorTaskRecord,
} from './supervisor-persistence.mapper';

type SupervisorTaskCreateArgs = {
  data: {
    id: string;
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
    createdAt: Date;
    updatedAt: Date;
  };
};

type SupervisorTaskUpdateArgs = {
  where: { id: string };
  data: Omit<SupervisorTaskCreateArgs['data'], 'id' | 'createdAt'>;
};

type SupervisorTaskUpdateManyArgs = {
  where: {
    id: string;
    updatedAt: Date;
  };
  data: Omit<SupervisorTaskCreateArgs['data'], 'id' | 'createdAt'>;
};

type SupervisorTaskDelegate = {
  create(args: SupervisorTaskCreateArgs): Promise<SupervisorTaskRecord>;
  findUnique(args: {
    where: { id: string };
  }): Promise<SupervisorTaskRecord | null>;
  findMany(args: {
    orderBy: { createdAt: 'asc' };
  }): Promise<SupervisorTaskRecord[]>;
  updateMany(
    args: SupervisorTaskUpdateManyArgs,
  ): Promise<{ count: number }>;
};

type PrismaWithSupervisorTask = {
  supervisorTask: SupervisorTaskDelegate;
};

function persistenceError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'supervisor_persistence_error',
  });
}

function taskCreateData(task: SupervisorTask): SupervisorTaskCreateArgs['data'] {
  return {
    id: task.id,
    objective: task.objective,
    owner: task.owner,
    status: task.status,
    allowedPaths: [...task.allowedPaths],
    forbiddenActions: [...task.forbiddenActions],
    dependsOn: [...task.dependsOn],
    acceptance: [...task.acceptance],
    evidence: task.evidence,
    blockingReason: task.blockingReason,
    failureReason: task.failureReason,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
  };
}

function taskUpdateData(task: SupervisorTask): SupervisorTaskUpdateArgs['data'] {
  const { id: _id, createdAt: _createdAt, ...data } = taskCreateData(task);
  return data;
}

@Injectable()
export class PrismaSupervisorTaskStore implements SupervisorTaskStore {
  private readonly delegate: SupervisorTaskDelegate;

  constructor(prisma: PrismaService) {
    this.delegate = (prisma as unknown as PrismaWithSupervisorTask).supervisorTask;
  }

  async list(): Promise<SupervisorTask[]> {
    return this.withPersistenceBoundary(async () => {
      const rows = await this.delegate.findMany({
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapTaskRecord);
    });
  }

  async get(id: string): Promise<SupervisorTask | null> {
    return this.withPersistenceBoundary(async () => {
      const row = await this.delegate.findUnique({ where: { id } });
      return row ? mapTaskRecord(row) : null;
    });
  }

  async create(task: SupervisorTask): Promise<SupervisorTask> {
    return this.withPersistenceBoundary(async () => {
      const row = await this.delegate.create({
        data: taskCreateData(task),
      });
      return mapTaskRecord(row);
    });
  }

  async saveIfUnchanged(
    task: SupervisorTask,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask | null> {
    return this.withPersistenceBoundary(async () => {
      const result = await this.delegate.updateMany({
        where: {
          id: task.id,
          updatedAt: new Date(expectedUpdatedAt),
        },
        data: taskUpdateData(task),
      });

      if (result.count === 0) {
        return null;
      }

      const row = await this.delegate.findUnique({
        where: { id: task.id },
      });

      if (!row) {
        throw persistenceError();
      }

      return mapTaskRecord(row);
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
