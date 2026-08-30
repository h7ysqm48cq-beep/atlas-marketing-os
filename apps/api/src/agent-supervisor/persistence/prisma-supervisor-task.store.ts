import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
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

type SupervisorTaskDelegate = {
  create(args: SupervisorTaskCreateArgs): Promise<SupervisorTaskRecord>;
  findUnique(args: {
    where: { id: string };
  }): Promise<SupervisorTaskRecord | null>;
  findMany(args: {
    orderBy: { createdAt: 'asc' };
  }): Promise<SupervisorTaskRecord[]>;
  update(args: SupervisorTaskUpdateArgs): Promise<SupervisorTaskRecord>;
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

  async save(task: SupervisorTask): Promise<SupervisorTask> {
    return this.withPersistenceBoundary(async () => {
      const row = await this.delegate.update({
        where: { id: task.id },
        data: taskUpdateData(task),
      });
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
