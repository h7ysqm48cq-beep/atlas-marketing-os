import { ConflictException, Injectable } from '@nestjs/common';
import type {
  SupervisorExecution,
  SupervisorExecutionStatus,
} from '../execution/supervisor-execution.types';
import type { SupervisorExecutionStore } from './supervisor-execution.store';
import type { SupervisorWorkerCapabilityFence } from '../worker/supervisor-worker-capability.types';

@Injectable()
export class MemorySupervisorExecutionStore implements SupervisorExecutionStore {
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
    const stored = this.cloneExecution({
      ...current,
      ...execution,
      assignment: current.assignment,
      claimedBy: current.claimedBy,
      claimEpoch: current.claimEpoch,
      claimedAt: current.claimedAt,
      leaseExpiresAt: current.leaseExpiresAt,
      lastHeartbeatAt: current.lastHeartbeatAt,
    });
    this.executions.set(stored.id, stored);
    return Promise.resolve(this.cloneExecution(stored));
  }

  saveIfClaimCurrent(
    execution: SupervisorExecution,
    expectedStatus: SupervisorExecutionStatus,
    fence: SupervisorWorkerCapabilityFence,
  ): Promise<SupervisorExecution> {
    const current = this.executions.get(execution.id);
    if (
      !current ||
      current.status !== expectedStatus ||
      current.claimedBy !== fence.claimedBy ||
      current.claimEpoch !== fence.claimEpoch ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt.getTime() <= fence.now.getTime()
    ) {
      return Promise.reject(
        new ConflictException({ code: 'execution_claim_conflict' }),
      );
    }
    const stored = this.cloneExecution({
      ...current,
      ...execution,
      assignment: current.assignment,
      claimedBy: current.claimedBy,
      claimEpoch: current.claimEpoch,
      claimedAt: current.claimedAt,
      leaseExpiresAt: current.leaseExpiresAt,
      lastHeartbeatAt: current.lastHeartbeatAt,
    });
    this.executions.set(stored.id, stored);
    return Promise.resolve(this.cloneExecution(stored));
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
        workerCapability: execution.assignment.workerCapability
          ? {
              ...execution.assignment.workerCapability,
              allowedOperations: [
                ...execution.assignment.workerCapability.allowedOperations,
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
      claimedAt: execution.claimedAt ? new Date(execution.claimedAt) : null,
      leaseExpiresAt: execution.leaseExpiresAt
        ? new Date(execution.leaseExpiresAt)
        : null,
      lastHeartbeatAt: execution.lastHeartbeatAt
        ? new Date(execution.lastHeartbeatAt)
        : null,
      createdAt: new Date(execution.createdAt),
      startedAt: execution.startedAt ? new Date(execution.startedAt) : null,
      completedAt: execution.completedAt
        ? new Date(execution.completedAt)
        : null,
    };
  }
}
