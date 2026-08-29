import { Injectable } from '@nestjs/common';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { SupervisorExecutionStore } from './supervisor-execution.store';

@Injectable()
export class MemorySupervisorExecutionStore
  implements SupervisorExecutionStore
{
  private readonly executions = new Map<string, SupervisorExecution>();
  private readonly order: string[] = [];

  async listByTask(taskId: string): Promise<SupervisorExecution[]> {
    return this.order
      .map((id) => this.executions.get(id))
      .filter(
        (execution): execution is SupervisorExecution =>
          Boolean(execution && execution.taskId === taskId),
      )
      .map((execution) => this.cloneExecution(execution));
  }

  async get(id: string): Promise<SupervisorExecution | null> {
    const execution = this.executions.get(id);
    return execution ? this.cloneExecution(execution) : null;
  }

  async create(execution: SupervisorExecution): Promise<SupervisorExecution> {
    const stored = this.cloneExecution(execution);
    this.executions.set(stored.id, stored);
    this.order.push(stored.id);
    return this.cloneExecution(stored);
  }

  async save(execution: SupervisorExecution): Promise<SupervisorExecution> {
    const stored = this.cloneExecution(execution);
    if (!this.executions.has(stored.id)) {
      this.order.push(stored.id);
    }
    this.executions.set(stored.id, stored);
    return this.cloneExecution(stored);
  }

  private cloneExecution(execution: SupervisorExecution): SupervisorExecution {
    return {
      ...execution,
      assignment: {
        ...execution.assignment,
        allowedPaths: [...execution.assignment.allowedPaths],
        forbiddenActions: [...execution.assignment.forbiddenActions],
        dependencies: [...execution.assignment.dependencies],
        acceptance: [...execution.assignment.acceptance],
        requiredEvidence: [...execution.assignment.requiredEvidence],
      },
      result: execution.result
        ? {
            summary: execution.result.summary,
            evidence: {
              ...execution.result.evidence,
              changedFiles: [...execution.result.evidence.changedFiles],
              tests: [...execution.result.evidence.tests],
              regression: [...execution.result.evidence.regression],
              remainingRisk: [...execution.result.evidence.remainingRisk],
            },
          }
        : null,
      createdAt: new Date(execution.createdAt),
      startedAt: execution.startedAt ? new Date(execution.startedAt) : null,
      completedAt: execution.completedAt
        ? new Date(execution.completedAt)
        : null,
    };
  }
}
