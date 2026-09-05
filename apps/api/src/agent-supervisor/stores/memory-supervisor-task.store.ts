import { Injectable } from '@nestjs/common';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorTaskStore } from './supervisor-task.store';

@Injectable()
export class MemorySupervisorTaskStore implements SupervisorTaskStore {
  private readonly tasks = new Map<string, SupervisorTask>();

  async list(): Promise<SupervisorTask[]> {
    return Array.from(this.tasks.values()).map((task) => this.cloneTask(task));
  }

  async get(id: string): Promise<SupervisorTask | null> {
    const task = this.tasks.get(id);
    return task ? this.cloneTask(task) : null;
  }

  async create(task: SupervisorTask): Promise<SupervisorTask> {
    const stored = this.cloneTask(task);
    this.tasks.set(stored.id, stored);
    return this.cloneTask(stored);
  }

  async saveIfUnchanged(
    task: SupervisorTask,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask | null> {
    const current = this.tasks.get(task.id);
    if (
      !current ||
      current.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      return null;
    }

    const stored = this.cloneTask(task);
    this.tasks.set(stored.id, stored);
    return this.cloneTask(stored);
  }

  private cloneTask(task: SupervisorTask): SupervisorTask {
    return {
      ...task,
      allowedPaths: [...task.allowedPaths],
      forbiddenActions: [...task.forbiddenActions],
      dependsOn: [...task.dependsOn],
      acceptance: [...task.acceptance],
      evidence: task.evidence ? structuredClone(task.evidence) : null,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt),
    };
  }
}
