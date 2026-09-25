import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import {
  SUPERVISOR_LIFECYCLE_STORE,
  type ExistingCandidateAtomicAdmission,
} from '../stores/supervisor-lifecycle.store';
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
    @Optional()
    @Inject(SUPERVISOR_LIFECYCLE_STORE)
    private readonly atomicAdmission?: ExistingCandidateAtomicAdmission,
  ) {}

  async dispatch(
    taskId: string,
    executionPurpose: SupervisorExecutionPurpose = 'IMPLEMENTATION',
    options: {
      frozenBaseSha?: string;
      verificationMode?: 'EXISTING_CANDIDATE';
      candidateBaseSha?: string;
      candidateHeadSha?: string;
      productionBaselineSha?: string;
    } = {},
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
    const executionWorkerRole =
      executionPurpose === 'INDEPENDENT_VERIFICATION'
        ? 'verifier'
        : task.owner;
    const permission = this.supervisor.checkPermission(
      executionWorkerRole,
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
    if (options.frozenBaseSha !== undefined) {
      if (executionPurpose === 'INDEPENDENT_VERIFICATION') {
        throw new BadRequestException(
          'frozen_base_sha_not_allowed_for_verification',
        );
      }
      const normalized = options.frozenBaseSha.trim().toLowerCase();
      if (!FULL_GIT_SHA.test(normalized)) {
        throw new BadRequestException('frozen_base_sha_invalid');
      }
      frozenBaseSha = normalized;
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
      workerRole: executionWorkerRole,
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
      ...(options.verificationMode ? {
        verificationMode: options.verificationMode,
        candidateBaseSha: options.candidateBaseSha,
        candidateHeadSha: options.candidateHeadSha,
        productionBaselineSha: options.productionBaselineSha,
      } : {}),
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
      workerRole: executionWorkerRole,
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

  async dispatchExistingCandidateVerification(
    taskId: string,
    input: {
      candidateBaseSha: string;
      candidateHeadSha: string;
      productionBaselineSha: string;
      changedPaths: string[];
    },
  ) {
    const task = await this.supervisor.getTask(taskId);
    if (!['BLOCKED', 'DRAFT'].includes(task.status) || task.evidence) {
      throw new BadRequestException('existing_candidate_task_not_admissible');
    }
    const executions = await this.executionStore.listByTask(taskId);
    if (task.status === 'DRAFT') {
      // Owner-created immutable candidate: no synthetic implementation execution.
      if (executions.length !== 0) {
        throw new BadRequestException('draft_existing_candidate_requires_empty_history');
      }
      // Bind the new task's recorded frozen identity, not arbitrary caller SHAs.
      if (!task.objective.toLowerCase().includes(input.candidateBaseSha?.toLowerCase()) ||
          !task.objective.toLowerCase().includes(input.candidateHeadSha?.toLowerCase())) {
        throw new BadRequestException('draft_existing_candidate_identity_mismatch');
      }
    } else if (!executions.some((execution) =>
      execution.status === 'FAILED' &&
      (execution.assignment.executionPurpose ?? 'IMPLEMENTATION') === 'IMPLEMENTATION',
    )) {
      throw new BadRequestException('failed_implementation_execution_required');
    }
    for (const sha of [
      input.candidateBaseSha,
      input.candidateHeadSha,
      input.productionBaselineSha,
    ]) {
      if (!FULL_GIT_SHA.test(sha)) {
        throw new BadRequestException('existing_candidate_sha_invalid');
      }
    }
    if (!Array.isArray(input.changedPaths) ||
        input.changedPaths.some(path => typeof path !== 'string' || !path.trim())) {
      throw new BadRequestException('existing_candidate_paths_invalid');
    }
    const runtimeRefresh = input.changedPaths.length === 0;
    const exactSha = input.candidateBaseSha.toLowerCase();
    if (runtimeRefresh ? (
      task.owner !== 'infra' ||
      !task.forbiddenActions.includes('edit_assigned_files') ||
      !task.forbiddenActions.includes('commit_assigned_branch') ||
      !/zero-git-diff.*api.*runtime refresh/i.test(task.objective) ||
      exactSha !== input.candidateHeadSha.toLowerCase() ||
      exactSha !== input.productionBaselineSha.toLowerCase() ||
      !task.acceptance.some(value => value.includes(`baseSha=headSha=${exactSha}`))
    ) : exactSha === input.candidateHeadSha.toLowerCase()) {
      throw new BadRequestException('runtime_refresh_identity_invalid');
    }
    // A DRAFT records the immutable candidate base/head, not an eternal
    // production tip. The runner MUST verify any later production baseline is
    // the actual canonical branch tip and has no overlapping changed paths.
    const canonical = (values: string[]) => [...new Set(values)].sort();
    if (!runtimeRefresh &&
      JSON.stringify(canonical(input.changedPaths)) !==
      JSON.stringify(canonical(task.allowedPaths))
    ) {
      throw new BadRequestException('existing_candidate_scope_mismatch');
    }
    if (this.atomicAdmission) {
      if (!(await this.supervisor.dependenciesReady(taskId))) {
        throw new BadRequestException('dependencies_not_ready');
      }
      const permission = this.supervisor.checkPermission('verifier', 'read_repo', {
        taskScopeIncludesAction: true,
      });
      if (!permission.allowed) {
        throw new BadRequestException({ code: 'verifier_permission_denied' });
      }
      const now = new Date();
      const executionId = this.nextExecutionId(now);
      const assignmentCore = {
        executionId, taskId: task.id, workerRole: 'verifier' as const,
        executionPurpose: 'INDEPENDENT_VERIFICATION' as const,
        objective: task.objective, allowedPaths: [...task.allowedPaths],
        forbiddenActions: Array.from(new Set([
          ...task.forbiddenActions, ...VERIFIER_FORBIDDEN_ACTIONS,
        ])),
        dependencies: [...task.dependsOn], acceptance: [...task.acceptance],
        requiredEvidence: [...REQUIRED_EVIDENCE],
        verificationMode: 'EXISTING_CANDIDATE' as const,
        candidateBaseSha: input.candidateBaseSha.toLowerCase(),
        candidateHeadSha: input.candidateHeadSha.toLowerCase(),
        productionBaselineSha: input.productionBaselineSha.toLowerCase(),
      };
      const assignment: WorkerAssignmentEnvelope = {
        ...assignmentCore,
        ...this.admissionManifestService.createBinding(assignmentCore),
      };
      this.requireAdmissionAuthorityBinding(assignment);
      const queued: SupervisorExecution = {
        id: executionId, taskId: task.id, workerRole: 'verifier',
        status: 'QUEUED', assignment, result: null, error: null,
        createdAt: now, startedAt: null, completedAt: null,
        runnerId: null, claimEpoch: 0,
        lastHeartbeatAt: null, leaseExpiresAt: null,
      };
      const admitted = await this.atomicAdmission.admitExistingCandidateAndQueue(
        task, queued,
      );
      if (!admitted) {
        throw new ConflictException({ code: 'existing_candidate_atomic_admission_conflict' });
      }
      return { execution: admitted.execution, assignment: admitted.execution.assignment };
    }
    // Memory-only test fallback. Production MUST inject the atomic lifecycle store.
    await this.supervisor.admitExistingCandidateVerification(taskId);
    return this.dispatch(taskId, 'INDEPENDENT_VERIFICATION', {
      verificationMode: 'EXISTING_CANDIDATE',
      candidateBaseSha: input.candidateBaseSha.toLowerCase(),
      candidateHeadSha: input.candidateHeadSha.toLowerCase(),
      productionBaselineSha: input.productionBaselineSha.toLowerCase(),
    });
  }

  async adoptExistingCandidateVerification(taskId: string, executionId: string) {
    const task = await this.supervisor.getTask(taskId);
    if (task.status !== 'VERIFYING' || task.evidence) {
      throw new BadRequestException('existing_candidate_task_not_reviewable');
    }
    if (!(await this.supervisor.ownsAllowedPaths(taskId))) {
      throw new BadRequestException('existing_candidate_file_ownership_missing');
    }
    const execution = await this.executionStore.get(executionId);
    if (!execution || execution.taskId !== taskId ||
        execution.status !== 'COMPLETED' || !execution.result ||
        execution.assignment.executionPurpose !== 'INDEPENDENT_VERIFICATION' ||
        execution.assignment.verificationMode !== 'EXISTING_CANDIDATE') {
      throw new BadRequestException('existing_candidate_completed_verifier_required');
    }
    const a = execution.assignment;
    const evidence = execution.result.evidence;
    const proof = evidence.existingCandidateVerification;
    const review = evidence.reviewCandidate;
    const paths = (xs: string[]) => [...new Set(xs)].sort();
    const identical = (left: string[], right: string[]) =>
      JSON.stringify(paths(left)) === JSON.stringify(paths(right));
    const runtimeRefresh = a.candidateBaseSha === a.candidateHeadSha;
    const expectedPaths = runtimeRefresh ? [] : task.allowedPaths;
    if (!proof || proof.mode !== a.verificationMode ||
        proof.sourceVerified !== true ||
        proof.taskId !== taskId || proof.executionId !== executionId ||
        proof.baseSha !== a.candidateBaseSha ||
        proof.headSha !== a.candidateHeadSha ||
        proof.productionBaselineSha !== a.productionBaselineSha ||
        !/^[0-9a-f]{64}$/i.test(proof.gitFingerprint) ||
        !a.manifestHash || !/^[0-9a-f]{64}$/i.test(a.manifestHash) ||
        !a.claimEpoch || a.claimEpoch < 1 ||
        !a.runnerId || !a.leaseId ||
        !task.objective.toLowerCase().includes(proof.baseSha.toLowerCase()) ||
        !task.objective.toLowerCase().includes(proof.headSha.toLowerCase()) ||
        !identical(proof.changedFiles, expectedPaths) ||
        !identical(evidence.changedFiles, expectedPaths) ||
        !identical(a.allowedPaths, task.allowedPaths) ||
        !review || review.action !== (runtimeRefresh ? 'deploy_production' : 'merge') ||
        review.targetBranch !== 'production/atlas' ||
        review.baseSha !== proof.baseSha ||
        review.headSha !== proof.headSha ||
        (runtimeRefresh && (proof.baseSha !== proof.headSha ||
          proof.headSha !== proof.productionBaselineSha)) ||
        !identical(review.changedFiles, expectedPaths) ||
        evidence.candidatePublication) {
      throw new BadRequestException('existing_candidate_verifier_identity_mismatch');
    }
    return this.supervisor.adoptExistingCandidateVerification(taskId, evidence);
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
