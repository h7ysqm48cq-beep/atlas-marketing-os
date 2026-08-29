import { Injectable } from '@nestjs/common';
import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorTaskStore } from './supervisor-task.store';

@Injectable()
export class MemorySupervisorTaskStore implements SupervisorTaskStore {
  private readonly tasks = new Map<string, SupervisorTask>();

  list(): SupervisorTask[] {
    return Array.from(this.tasks.values()).map((task) => this.cloneTask(task));
  }

  get(id: string): SupervisorTask | null {
    const task = this.tasks.get(id);
    return task ? this.cloneTask(task) : null;
  }

  create(task: SupervisorTask): SupervisorTask {
    const stored = this.cloneTask(task);
    this.tasks.set(stored.id, stored);
    return this.cloneTask(stored);
  }

  save(task: SupervisorTask): SupervisorTask {
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
      evidence: task.evidence
        ? {
            ...task.evidence,
            changedFiles: [...task.evidence.changedFiles],
            tests: [...task.evidence.tests],
            regression: [...task.evidence.regression],
            remainingRisk: [...task.evidence.remainingRisk],
          }
        : null,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt),
    };
  }
}
