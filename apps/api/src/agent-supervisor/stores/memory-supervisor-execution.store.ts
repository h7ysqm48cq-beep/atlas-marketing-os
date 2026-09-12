import { ConflictException, Injectable } from '@nestjs/common';
import type {
  SupervisorExecution,
  SupervisorExecutionStatus,
} from '../execution/supervisor-execution.types';
import type {
  SupervisorExecutionClaimInput,
  SupervisorExecutionClaimStore,
  SupervisorExecutionHeartbeatInput,
  SupervisorExecutionHeartbeatStore,
  SupervisorExecutionStore,
} from './supervisor-execution.store';

@Injectable()
export class MemorySupervisorExecutionStore
  implements
    SupervisorExecutionStore,
    SupervisorExecutionClaimStore,
    SupervisorExecutionHeartbeatStore
{
  private readonly executions = new Map<string, SupervisorExecution>();
  private readonly order: string[] = [];

  listByTask(taskId: string): Promise<SupervisorExecution[]> {
    return Promise.resolve(
      this.order
        .map((id) => this.executions.get(id))
        .filter((execution): execution is SupervisorExecution =>
          Boolean(execution && execution.taskId === taskId),
        )
        .map((execution) => this.cloneExecution(execution)),
    );
  }

  get(id: string): Promise<SupervisorExecution | null> {
    const execution = this.executions.get(id);
    return Promise.resolve(execution ? this.cloneExecution(execution) : null);
  }

  create(execution: SupervisorExecution): Promise<SupervisorExecution> {
    const stored = this.cloneExecution(execution);
    this.executions.set(stored.id, stored);
    this.order.push(stored.id);
    return Promise.resolve(this.cloneExecution(stored));
  }

  save(execution: SupervisorExecution): Promise<SupervisorExecution> {
    const stored = this.cloneExecution(execution);
    if (!this.executions.has(stored.id)) {
      this.order.push(stored.id);
    }
    this.executions.set(stored.id, stored);
    return Promise.resolve(this.cloneExecution(stored));
  }

  saveIfStatus(
    execution: SupervisorExecution,
    expectedStatus: SupervisorExecutionStatus,
  ): Promise<SupervisorExecution> {
    const current = this.executions.get(execution.id);
    if (!current || current.status !== expectedStatus) {
      return Promise.reject(
        new ConflictException({
          code: 'execution_state_conflict',
          expected: expectedStatus,
        }),
      );
    }
    const stored = this.cloneExecution(execution);
    this.executions.set(stored.id, stored);
    return Promise.resolve(this.cloneExecution(stored));
  }

  claimNext(
    input: SupervisorExecutionClaimInput,
  ): Promise<SupervisorExecution | null> {
    let selected: SupervisorExecution | undefined;
    for (const id of this.order) {
      const candidate = this.executions.get(id);
      if (
        !candidate ||
        candidate.status !== 'QUEUED' ||
        candidate.workerRole !== input.workerRole ||
        (selected &&
          (candidate.createdAt.getTime() > selected.createdAt.getTime() ||
            (candidate.createdAt.getTime() === selected.createdAt.getTime() &&
              candidate.id >= selected.id)))
      ) {
        continue;
      }
      selected = candidate;
    }

    if (!selected) {
      return Promise.resolve(null);
    }

    const nextClaimEpoch = selected.claimEpoch + 1;
    const assignment = {
      ...selected.assignment,
      claimEpoch: nextClaimEpoch,
      runnerId: input.runnerId,
      leaseId: input.leaseId,
    };
    delete assignment.workerCapability;

    const stored = this.cloneExecution({
      ...selected,
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
    });
    this.executions.set(stored.id, stored);
    return Promise.resolve(this.cloneExecution(stored));
  }

  heartbeat = (
    input: SupervisorExecutionHeartbeatInput,
  ): Promise<SupervisorExecution | null> => {
    const current = this.executions.get(input.executionId);
    if (
      !current ||
      current.taskId !== input.taskId ||
      current.workerRole !== input.workerRole ||
      current.status !== 'RUNNING' ||
      current.claimEpoch !== input.claimEpoch ||
      current.runnerId !== input.runnerId ||
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
      return Promise.resolve(null);
    }

    current.lastHeartbeatAt = new Date(input.now);
    current.leaseExpiresAt = new Date(input.leaseExpiresAt);
    return Promise.resolve(this.cloneExecution(current));
  };

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
        workerCapability: execution.assignment.workerCapability
          ? {
              ...execution.assignment.workerCapability,
              allowedActions: [
                ...execution.assignment.workerCapability.allowedActions,
              ],
            }
          : undefined,
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
      lastHeartbeatAt: execution.lastHeartbeatAt
        ? new Date(execution.lastHeartbeatAt)
        : null,
      leaseExpiresAt: execution.leaseExpiresAt
        ? new Date(execution.leaseExpiresAt)
        : null,
    };
  }
}
