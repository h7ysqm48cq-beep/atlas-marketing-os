import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  RequiredEvidenceField,
  SupervisorExecution,
  SupervisorExecutionStatus,
  WorkerAssignmentEnvelope,
  WorkerExecutionResult,
} from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';

const REQUIRED_EVIDENCE: RequiredEvidenceField[] = [
  'rootCause',
  'changedFiles',
  'tests',
  'build',
  'regression',
  'deploymentState',
  'gitState',
  'remainingRisk',
];

@Injectable()
export class WorkerDispatcherService {
  private sequence = 0;

  constructor(
    private readonly supervisor: AgentSupervisorService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
  ) {}

  async dispatch(taskId: string): Promise<{
    execution: SupervisorExecution;
    assignment: WorkerAssignmentEnvelope;
  }> {
    const task = await this.supervisor.getTask(taskId);
    if (task.status !== 'WORKING') {
      throw new BadRequestException({
        code: 'task_not_dispatchable',
        current: task.status,
        required: 'WORKING',
      });
    }

    if (!(await this.supervisor.dependenciesReady(taskId))) {
      throw new BadRequestException('dependencies_not_ready');
    }

    if (!(await this.supervisor.ownsAllowedPaths(taskId))) {
      throw new ConflictException('file_ownership_missing');
    }

    const permission = this.supervisor.checkPermission(
      task.owner,
      'edit_assigned_files',
      { taskScopeIncludesAction: true },
    );
    if (!permission.allowed) {
      throw new BadRequestException({
        code: 'worker_permission_denied',
        reason: permission.reason,
      });
    }

    const now = new Date();
    const executionId = this.nextExecutionId(now);
    const assignment: WorkerAssignmentEnvelope = {
      executionId,
      taskId: task.id,
      workerRole: task.owner,
      objective: task.objective,
      allowedPaths: [...task.allowedPaths],
      forbiddenActions: [...task.forbiddenActions],
      dependencies: [...task.dependsOn],
      acceptance: [...task.acceptance],
      requiredEvidence: [...REQUIRED_EVIDENCE],
    };

    const queued = await this.executionStore.create({
      id: executionId,
      taskId: task.id,
      workerRole: task.owner,
      status: 'QUEUED',
      assignment,
      result: null,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });

    queued.status = 'DISPATCHED';
    const execution = await this.executionStore.save(queued);

    return {
      execution,
      assignment: execution.assignment,
    };
  }

  async listByTask(taskId: string): Promise<SupervisorExecution[]> {
    await this.supervisor.getTask(taskId);
    return this.executionStore.listByTask(taskId);
  }

  async getExecution(executionId: string): Promise<SupervisorExecution> {
    return this.requireExecution(executionId);
  }

  async markRunning(executionId: string): Promise<SupervisorExecution> {
    const execution = await this.requireExecution(executionId);
    this.requireExecutionStatus(execution, ['DISPATCHED']);

    execution.status = 'RUNNING';
    execution.startedAt = new Date();
    execution.error = null;
    return this.executionStore.save(execution);
  }

  async complete(
    executionId: string,
    result: WorkerExecutionResult,
  ): Promise<SupervisorExecution> {
    const execution = await this.requireExecution(executionId);
    this.requireExecutionStatus(execution, ['RUNNING']);
    if (!result.summary?.trim()) {
      throw new BadRequestException('worker_result_summary_required');
    }

    execution.status = 'COMPLETED';
    execution.result = {
      summary: result.summary.trim(),
      evidence: {
        ...result.evidence,
        changedFiles: [...result.evidence.changedFiles],
        tests: [...result.evidence.tests],
        regression: [...result.evidence.regression],
        remainingRisk: [...result.evidence.remainingRisk],
      },
    };
    execution.error = null;
    execution.completedAt = new Date();
    return this.executionStore.save(execution);
  }

  async fail(executionId: string, error: string): Promise<SupervisorExecution> {
    const execution = await this.requireExecution(executionId);
    this.requireExecutionStatus(execution, ['RUNNING']);
    if (!error?.trim()) {
      throw new BadRequestException('worker_execution_error_required');
    }

    execution.status = 'FAILED';
    execution.error = error.trim();
    execution.completedAt = new Date();
    return this.executionStore.save(execution);
  }

  async cancel(
    executionId: string,
    reason: string,
  ): Promise<SupervisorExecution> {
    const execution = await this.requireExecution(executionId);
    this.requireExecutionStatus(execution, ['DISPATCHED', 'RUNNING']);
    if (!reason?.trim()) {
      throw new BadRequestException('worker_execution_cancel_reason_required');
    }

    execution.status = 'CANCELLED';
    execution.error = reason.trim();
    execution.completedAt = new Date();
    return this.executionStore.save(execution);
  }

  private async requireExecution(
    executionId: string,
  ): Promise<SupervisorExecution> {
    const execution = await this.executionStore.get(executionId);
    if (!execution) {
      throw new NotFoundException(
        `supervisor_execution_not_found:${executionId}`,
      );
    }
    return execution;
  }

  private requireExecutionStatus(
    execution: SupervisorExecution,
    allowed: SupervisorExecutionStatus[],
  ) {
    if (!allowed.includes(execution.status)) {
      throw new BadRequestException({
        code: 'invalid_execution_transition',
        current: execution.status,
        allowedFrom: allowed,
      });
    }
  }

  private nextExecutionId(now: Date) {
    this.sequence += 1;
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `ATLAS-EXEC-${date}-${String(this.sequence).padStart(4, '0')}`;
  }
}
