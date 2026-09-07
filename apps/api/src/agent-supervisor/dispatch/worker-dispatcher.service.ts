import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type { SupervisorAction } from '../agent-supervisor.types';
import type {
  RequiredEvidenceField,
  RunnerEligibility,
  SupervisorExecution,
  SupervisorExecutionPurpose,
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

const PROTECTED_INTEGRATION_ACTIONS: SupervisorAction[] = [
  'merge',
  'rebase',
  'squash',
  'cherry_pick',
  'auto_merge',
  'force_push',
  'delete_branch_for_integration',
];

const ACTIVE_EXECUTION_STATUSES: SupervisorExecutionStatus[] = [
  'QUEUED',
  'DISPATCHED',
  'RUNNING',
];

const SYNTHETIC_FORBIDDEN_EVIDENCE_FIELDS = [
  'reviewCandidate',
  'ownerMergeAuthorization',
  'ownerMergeAuthorizationConsumption',
  'ownerDeploymentAuthorization',
  'ownerDeploymentAuthorizationRevocations',
] as const;

@Injectable()
export class WorkerDispatcherService {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
  ) {}

  async dispatch(
    taskId: string,
    executionPurpose: SupervisorExecutionPurpose = 'IMPLEMENTATION',
    runnerEligibility: RunnerEligibility = 'STANDARD',
  ): Promise<{
    execution: SupervisorExecution;
    assignment: WorkerAssignmentEnvelope;
  }> {
    if (
      runnerEligibility === 'A1_SYNTHETIC' &&
      executionPurpose !== 'IMPLEMENTATION'
    ) {
      throw new BadRequestException({
        code: 'runner_execution_not_eligible',
      });
    }

    const task = await this.supervisor.getTask(taskId);
    if (task.status !== 'WORKING') {
      throw new BadRequestException({
        code: 'task_not_dispatchable',
        current: task.status,
        required: 'WORKING',
      });
    }

    const existingExecutions = await this.executionStore.listByTask(taskId);
    if (
      existingExecutions.some((execution) =>
        ACTIVE_EXECUTION_STATUSES.includes(execution.status),
      )
    ) {
      throw new ConflictException({
        code: 'active_execution_exists',
        taskId,
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
      executionPurpose,
      runnerEligibility,
      objective: task.objective,
      allowedPaths: [...task.allowedPaths],
      forbiddenActions: Array.from(
        new Set([...task.forbiddenActions, ...PROTECTED_INTEGRATION_ACTIONS]),
      ),
      dependencies: [...task.dependsOn],
      acceptance: [...task.acceptance],
      requiredEvidence: [...REQUIRED_EVIDENCE],
    };

    const queued: SupervisorExecution = {
      id: executionId,
      taskId: task.id,
      workerRole: task.owner,
      status: 'QUEUED',
      assignment,
      result: null,
      error: null,
      claimedBy: null,
      claimEpoch: 0,
      claimedAt: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    const created = await this.executionStore.create(queued);

    created.status = 'DISPATCHED';
    const execution = await this.executionStore.saveIfStatus(created, 'QUEUED');

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
    return this.executionStore.saveIfStatus(execution, 'DISPATCHED');
  }

  async complete(
    executionId: string,
    result: WorkerExecutionResult,
  ): Promise<SupervisorExecution> {
    const execution = await this.requireExecution(executionId);
    this.requireExecutionStatus(execution, ['RUNNING']);
    this.validateWorkerResult(result);
    if (execution.assignment.runnerEligibility === 'A1_SYNTHETIC') {
      this.validateSyntheticWorkerResult(result);
    }

    execution.status = 'COMPLETED';
    execution.result = {
      summary: result.summary.trim(),
      evidence: {
        ...result.evidence,
        rootCause: result.evidence.rootCause.trim(),
        changedFiles: [...result.evidence.changedFiles],
        tests: [...result.evidence.tests],
        build: result.evidence.build.trim(),
        regression: [...result.evidence.regression],
        deploymentState: result.evidence.deploymentState.trim(),
        gitState: result.evidence.gitState.trim(),
        remainingRisk: [...result.evidence.remainingRisk],
      },
    };
    execution.error = null;
    execution.completedAt = new Date();
    return this.executionStore.saveIfStatus(execution, 'RUNNING');
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
    return this.executionStore.saveIfStatus(execution, 'RUNNING');
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

    const previousStatus = execution.status;
    execution.status = 'CANCELLED';
    execution.error = reason.trim();
    execution.completedAt = new Date();
    return this.executionStore.saveIfStatus(execution, previousStatus);
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

  private validateWorkerResult(result: WorkerExecutionResult) {
    const evidence = result?.evidence;
    const valid =
      Boolean(result?.summary?.trim()) &&
      Boolean(evidence?.rootCause?.trim()) &&
      Array.isArray(evidence?.changedFiles) &&
      Array.isArray(evidence?.tests) &&
      Boolean(evidence?.build?.trim()) &&
      Array.isArray(evidence?.regression) &&
      Boolean(evidence?.deploymentState?.trim()) &&
      Boolean(evidence?.gitState?.trim()) &&
      Array.isArray(evidence?.remainingRisk);

    if (!valid) {
      throw new BadRequestException({
        code: 'invalid_worker_result',
      });
    }
  }

  private validateSyntheticWorkerResult(result: WorkerExecutionResult) {
    const evidence = result.evidence;
    const valid =
      evidence.rootCause === 'synthetic_runner_claim_plane_validation' &&
      evidence.changedFiles.length === 0 &&
      evidence.build === 'NOT_RUN_SYNTHETIC' &&
      evidence.deploymentState === 'NONE' &&
      evidence.gitState === 'UNCHANGED' &&
      SYNTHETIC_FORBIDDEN_EVIDENCE_FIELDS.every(
        (field) => !Object.prototype.hasOwnProperty.call(evidence, field),
      );

    if (!valid) {
      throw new BadRequestException({
        code: 'synthetic_execution_evidence_violation',
      });
    }
  }

  private nextExecutionId(now: Date) {
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `ATLAS-EXEC-${date}-${randomUUID()}`;
  }
}
