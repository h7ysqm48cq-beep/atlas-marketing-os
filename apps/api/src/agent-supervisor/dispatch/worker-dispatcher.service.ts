import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { SupervisorAdmissionManifestService } from '../authority/supervisor-admission-manifest.service';
import type { SupervisorAction } from '../agent-supervisor.types';
import type {
  RequiredEvidenceField,
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
import { SupervisorWorkerCapabilityService } from '../worker/supervisor-worker-capability.service';

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

const VERIFIER_FORBIDDEN_ACTIONS: SupervisorAction[] = [
  'edit_assigned_files',
  'commit_assigned_branch',
  'change_database_schema',
  'run_migration',
  'change_auth_or_identity',
  'change_runtime_config',
  'deploy_non_production',
  'deploy_production',
  'merge',
  'rebase',
  'squash',
  'cherry_pick',
  'auto_merge',
  'force_push',
  'delete_branch_for_integration',
];

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

const ACTIVE_EXECUTION_STATUSES: SupervisorExecutionStatus[] = [
  'QUEUED',
  'DISPATCHED',
  'RUNNING',
];

@Injectable()
export class WorkerDispatcherService {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
    private readonly capabilityService: SupervisorWorkerCapabilityService,
    private readonly admissionManifestService: SupervisorAdmissionManifestService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async dispatch(
    taskId: string,
    executionPurpose: SupervisorExecutionPurpose = 'IMPLEMENTATION',
    options: { frozenBaseSha?: string } = {},
  ): Promise<{
    execution: SupervisorExecution;
    assignment: WorkerAssignmentEnvelope;
    capability?: string;
  }> {
    const task = await this.supervisor.getTask(taskId);
    const requiredStatus =
      executionPurpose === 'INDEPENDENT_VERIFICATION'
        ? 'VERIFYING'
        : 'WORKING';
    if (task.status !== requiredStatus) {
      throw new BadRequestException({
        code: 'task_not_dispatchable',
        current: task.status,
        required: requiredStatus,
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

    const requestedAction: SupervisorAction =
      executionPurpose === 'INDEPENDENT_VERIFICATION'
        ? 'read_repo'
        : 'edit_assigned_files';
    const permission = this.supervisor.checkPermission(
      task.owner,
      requestedAction,
      { taskScopeIncludesAction: true },
    );
    if (!permission.allowed) {
      throw new BadRequestException({
        code: 'worker_permission_denied',
        reason: permission.reason,
      });
    }

    let frozenBaseSha: string | undefined;
    const signedRequired = this.config?.get<string>(
      'ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE',
    ) === 'required';
    if (options.frozenBaseSha !== undefined &&
        executionPurpose === 'INDEPENDENT_VERIFICATION') {
      throw new BadRequestException(
        'frozen_base_sha_not_allowed_for_verification',
      );
    }
    if (signedRequired && executionPurpose === 'INDEPENDENT_VERIFICATION') {
      // A verifier cannot choose its own base: bind the frozen, persisted
      // implementation candidate BEFORE the admission manifest is signed.
      const candidate = task.evidence?.reviewCandidate;
      const evidenceFiles = task.evidence?.changedFiles;
      if (!candidate || !FULL_GIT_SHA.test(candidate.baseSha) ||
          !FULL_GIT_SHA.test(candidate.headSha) ||
          candidate.targetBranch !== 'production/atlas' ||
          !Array.isArray(evidenceFiles) ||
          candidate.changedFiles.length !== evidenceFiles.length ||
          [...candidate.changedFiles].sort().join('\u0000') !==
            [...evidenceFiles].sort().join('\u0000')) {
        throw new BadRequestException('signed_verifier_frozen_candidate_required');
      }
      frozenBaseSha = candidate.baseSha.toLowerCase();
    } else if (options.frozenBaseSha !== undefined) {
      const normalized = options.frozenBaseSha.trim().toLowerCase();
      if (!FULL_GIT_SHA.test(normalized)) {
        throw new BadRequestException('frozen_base_sha_invalid');
      }
      frozenBaseSha = normalized;
    }
    if (signedRequired && !frozenBaseSha) {
      throw new BadRequestException('signed_implementation_frozen_base_required');
    }

    const now = new Date();
    const executionId = this.nextExecutionId(now);
    const enforcedForbiddenActions =
      executionPurpose === 'INDEPENDENT_VERIFICATION'
        ? VERIFIER_FORBIDDEN_ACTIONS
        : PROTECTED_INTEGRATION_ACTIONS;
    const assignmentCore = {
      executionId,
      taskId: task.id,
      workerRole: task.owner,
      executionPurpose,
      objective: task.objective,
      allowedPaths: [...task.allowedPaths],
      forbiddenActions: Array.from(
        new Set([
          ...task.forbiddenActions,
          ...enforcedForbiddenActions,
        ]),
      ),
      dependencies: [...task.dependsOn],
      acceptance: [...task.acceptance],
      requiredEvidence: [...REQUIRED_EVIDENCE],
      ...(frozenBaseSha ? { frozenBaseSha } : {}),
    };

    const authorityBinding =
      this.admissionManifestService.createBinding(assignmentCore);

    const assignment: WorkerAssignmentEnvelope = {
      ...assignmentCore,
      ...authorityBinding,
    };
    this.requireAdmissionAuthorityBinding(assignment);

    const queued: SupervisorExecution = {
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
      runnerId: null,
      claimEpoch: 0,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
    };
    const execution = await this.executionStore.create(queued);

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
    if (this.config?.get<string>(
      'ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE',
    ) === 'required') {
      throw new ForbiddenException('signed_worker_claim_required');
    }
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
    if (this.config?.get<string>('ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE') === 'required') {
      throw new ForbiddenException('signed_worker_completion_required');
    }
    const execution = await this.requireExecution(executionId);
    this.requireExecutionStatus(execution, ['RUNNING']);
    this.validateWorkerResult(result);

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

  private requireAdmissionAuthorityBinding(
    assignment: WorkerAssignmentEnvelope,
  ): void {
    const valid =
      typeof assignment.manifestHash === 'string' &&
      /^[0-9a-f]{64}$/i.test(assignment.manifestHash) &&
      typeof assignment.claimEpoch === 'number' &&
      Number.isInteger(assignment.claimEpoch) &&
      assignment.claimEpoch >= 0 &&
      typeof assignment.leaseId === 'string' &&
      assignment.leaseId.trim().length > 0 &&
      typeof assignment.runnerId === 'string' &&
      assignment.runnerId.trim().length > 0;

    if (!valid) {
      throw new BadRequestException(
        'worker_capability_authority_binding_required',
      );
    }
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

  private nextExecutionId(now: Date) {
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `ATLAS-EXEC-${date}-${randomUUID()}`;
  }
}
