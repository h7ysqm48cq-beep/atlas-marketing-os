import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  IntegrationGateInput,
  ProductionDeploymentGateInput,
  ProductionDeploymentResolveInput,
  SupervisorEvidence,
  SupervisorGateDecision,
  SupervisorReviewCandidate,
  SupervisorTask,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import { ProductionDeploymentGateService } from '../deployment/production-deployment-gate.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';

const ACTIVE_IMPLEMENTATION_STATUSES = new Set(['DISPATCHED', 'RUNNING']);
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

@Injectable()
export class AgentGatewayService {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
    private readonly productionDeploymentGate: ProductionDeploymentGateService = new ProductionDeploymentGateService(),
  ) {}

  async validateWorkerContext(
    input: ValidateWorkerContextInput,
  ): Promise<SupervisorGateDecision> {
    const task = await this.supervisor.getTask(input.taskId);
    if (task.status !== 'WORKING') {
      throw new BadRequestException({
        code: 'task_not_implementation_ready',
        current: task.status,
      });
    }

    const execution = await this.requireExecution(task, input.executionId);
    if (!ACTIVE_IMPLEMENTATION_STATUSES.has(execution.status)) {
      throw new BadRequestException({
        code: 'execution_not_active',
        current: execution.status,
      });
    }

    if (!(await this.supervisor.ownsAllowedPaths(task.id))) {
      throw new BadRequestException({ code: 'file_ownership_missing' });
    }

    this.validateChangedFiles(
      execution.assignment.allowedPaths,
      input.changedFiles ?? [],
    );

    if (input.requestedAction) {
      if (
        execution.assignment.forbiddenActions.includes(input.requestedAction)
      ) {
        throw new BadRequestException({
          code: 'worker_protected_action_denied',
        });
      }

      const permission = this.supervisor.checkPermission(
        execution.workerRole,
        input.requestedAction,
        {
          taskScopeIncludesAction: true,
          supervisorAuthorization: true,
        },
      );
      if (!permission.allowed) {
        throw new BadRequestException({
          code: permission.reason ?? 'permission_denied',
        });
      }
    }

    return this.allowed(task.id, execution.id);
  }

  async submitImplementationFromExecution(
    taskId: string,
    executionId: string,
  ): Promise<SupervisorTask> {
    const task = await this.supervisor.getTask(taskId);
    if (task.status !== 'WORKING') {
      throw new BadRequestException({
        code: 'task_not_implementation_ready',
        current: task.status,
      });
    }

    const execution = await this.requireExecution(task, executionId);
    if (execution.status !== 'COMPLETED' || !execution.result) {
      throw new BadRequestException({
        code: 'execution_not_completed',
        current: execution.status,
      });
    }

    this.validateChangedFiles(
      execution.assignment.allowedPaths,
      execution.result.evidence.changedFiles,
    );

    return this.supervisor.submitImplementation(
      task.id,
      execution.result.evidence,
    );
  }

  async checkReviewCandidate(
    input: IntegrationGateInput,
  ): Promise<SupervisorGateDecision> {
    const { task, execution, requestedCandidate } =
      await this.validateIntegrationCandidate(input);
    this.supervisor.assertOwnerMergeAuthorization(task, requestedCandidate);
    return this.allowed(task.id, execution.id);
  }

  async checkIntegration(
    input: IntegrationGateInput,
  ): Promise<SupervisorGateDecision> {
    const { task, execution, requestedCandidate } =
      await this.validateIntegrationCandidate(input);
    this.supervisor.assertOwnerMergeAuthorization(task, requestedCandidate);

    if (!input.explicitUserAuthorization) {
      throw new BadRequestException({
        code: 'explicit_user_authorization_required',
      });
    }

    const permission = this.supervisor.checkPermission(
      'supervisor',
      input.action,
      {
        explicitUserAuthorization: true,
        supervisorAuthorization: true,
        taskScopeIncludesAction: true,
      },
    );
    if (!permission.allowed) {
      throw new BadRequestException({
        code: permission.reason ?? 'permission_denied',
      });
    }

    return this.allowed(task.id, execution.id);
  }

  async checkProductionDeployment(
    input: ProductionDeploymentGateInput,
  ): Promise<SupervisorGateDecision> {
    const { task, execution, persistedCandidate } =
      await this.validatePersistedCandidate(input.taskId, input.executionId);
    if (persistedCandidate.action !== 'deploy_production') {
      throw new BadRequestException({
        code: 'production_deployment_candidate_required',
      });
    }
    if (persistedCandidate.targetBranch !== 'production/atlas') {
      throw new BadRequestException({ code: 'canonical_target_required' });
    }

    this.productionDeploymentGate.assertProductionDeployment({
      service: input.service,
      supervisorApprovedSha: persistedCandidate.headSha,
      github: input.github,
    });
    if (task.status !== 'APPROVED') {
      throw new BadRequestException({ code: 'task_not_deployment_approved' });
    }
    this.supervisor.assertOwnerDeploymentAuthorization(
      task,
      persistedCandidate,
      input.service,
    );
    return this.allowed(task.id, execution.id);
  }

  async resolveProductionDeployment(
    input: ProductionDeploymentResolveInput,
  ): Promise<SupervisorGateDecision> {
    const requestedSha = input.github?.commitSha ?? '';
    this.productionDeploymentGate.assertProductionDeployment({
      service: input.service,
      supervisorApprovedSha: requestedSha,
      github: input.github,
    });

    const normalizedSha = requestedSha.toLowerCase();
    const approvedTasks = (await this.supervisor.listTasks()).filter(
      (task) => task.status === 'APPROVED',
    );
    const shaMatches: Array<{
      task: SupervisorTask;
      candidate: SupervisorReviewCandidate;
    }> = [];

    for (const task of approvedTasks) {
      const rawCandidate = task.evidence?.reviewCandidate;
      if (
        !rawCandidate ||
        rawCandidate.action !== 'deploy_production' ||
        rawCandidate.targetBranch !== 'production/atlas' ||
        rawCandidate.headSha.toLowerCase() !== normalizedSha
      ) {
        continue;
      }
      const candidate = this.normalizeCandidate(rawCandidate);
      if (candidate.headSha === normalizedSha) {
        shaMatches.push({ task, candidate });
      }
    }

    if (shaMatches.length === 0) {
      throw new BadRequestException({
        code: 'production_deployment_resolution_not_found',
      });
    }

    const serviceMatches = shaMatches.filter(
      ({ task }) =>
        task.evidence?.ownerDeploymentAuthorization?.service === input.service,
    );
    if (serviceMatches.length === 0) {
      if (shaMatches.length === 1) {
        const only = shaMatches[0];
        this.supervisor.assertOwnerDeploymentAuthorization(
          only.task,
          only.candidate,
          input.service,
        );
      }
      throw new BadRequestException({
        code: 'production_deployment_resolution_not_found',
      });
    }
    if (serviceMatches.length > 1) {
      throw new BadRequestException({
        code: 'production_deployment_resolution_ambiguous',
      });
    }

    const { task, candidate } = serviceMatches[0];
    this.productionDeploymentGate.assertProductionDeployment({
      service: input.service,
      supervisorApprovedSha: candidate.headSha,
      github: input.github,
    });
    this.supervisor.assertOwnerDeploymentAuthorization(
      task,
      candidate,
      input.service,
    );

    const executions = await this.executionStore.listByTask(task.id);
    const matchingExecutions: SupervisorExecution[] = [];
    for (const execution of executions) {
      if (execution.status !== 'COMPLETED' || !execution.result) continue;
      const rawCandidate = execution.result.evidence.reviewCandidate;
      if (!rawCandidate) continue;
      const executionCandidate = this.normalizeCandidate(rawCandidate);
      if (this.sameCandidate(candidate, executionCandidate)) {
        matchingExecutions.push(execution);
      }
    }

    if (matchingExecutions.length === 0) {
      throw new BadRequestException({
        code: 'production_deployment_resolution_not_found',
      });
    }
    if (matchingExecutions.length > 1) {
      throw new BadRequestException({
        code: 'production_deployment_resolution_ambiguous',
      });
    }

    const validated = await this.validatePersistedCandidate(
      task.id,
      matchingExecutions[0].id,
    );
    return this.allowed(validated.task.id, validated.execution.id);
  }

  private async validateIntegrationCandidate(input: IntegrationGateInput) {
    const { task, execution, persistedCandidate } =
      await this.validatePersistedCandidate(
        input.taskId,
        input.executionId,
        input.changedFiles,
      );
    const requestedCandidate = this.normalizeRequestedCandidate(input);

    if (!this.sameCandidate(persistedCandidate, requestedCandidate)) {
      throw new BadRequestException({ code: 'review_candidate_mismatch' });
    }

    if (
      requestedCandidate.action === 'merge' &&
      requestedCandidate.targetBranch !== 'production/atlas'
    ) {
      throw new BadRequestException({ code: 'canonical_target_required' });
    }

    return { task, execution, requestedCandidate };
  }

  private async validatePersistedCandidate(
    taskId: string,
    executionId: string,
    changedFiles?: string[],
  ) {
    const task = await this.supervisor.getTask(taskId);
    if (!['READY_FOR_REVIEW', 'APPROVED'].includes(task.status)) {
      throw new BadRequestException({
        code: 'task_not_integration_ready',
        current: task.status,
      });
    }

    const execution = await this.requireExecution(task, executionId);
    if (execution.status !== 'COMPLETED' || !execution.result) {
      throw new BadRequestException({
        code: 'execution_not_completed',
        current: execution.status,
      });
    }

    if (changedFiles) {
      this.validateChangedFiles(
        execution.assignment.allowedPaths,
        changedFiles,
      );
    }
    const taskCandidate = this.requirePersistedCandidate(task.evidence);
    const executionCandidate = this.requirePersistedCandidate(
      execution.result.evidence,
    );

    this.requireCandidateMatchesEvidence(taskCandidate, task.evidence!);
    this.requireCandidateMatchesEvidence(
      executionCandidate,
      execution.result.evidence,
    );

    if (!this.sameCandidate(taskCandidate, executionCandidate)) {
      throw new BadRequestException({ code: 'review_candidate_mismatch' });
    }

    return { task, execution, persistedCandidate: taskCandidate };
  }

  private async requireExecution(
    task: SupervisorTask,
    executionId: string,
  ): Promise<SupervisorExecution> {
    const execution = await this.executionStore.get(executionId);
    if (!execution) {
      throw new NotFoundException({ code: 'execution_not_found' });
    }
    if (execution.taskId !== task.id) {
      throw new BadRequestException({ code: 'execution_task_mismatch' });
    }
    return execution;
  }

  private normalizeRequestedCandidate(
    input: IntegrationGateInput,
  ): SupervisorReviewCandidate {
    if (!input.targetBranch || !input.baseSha || !input.headSha) {
      throw new BadRequestException({ code: 'review_candidate_incomplete' });
    }

    return this.normalizeCandidate({
      action: input.action,
      targetBranch: input.targetBranch,
      baseSha: input.baseSha,
      headSha: input.headSha,
      changedFiles: input.changedFiles,
    });
  }

  private requirePersistedCandidate(
    evidence: SupervisorEvidence | null,
  ): SupervisorReviewCandidate {
    if (!evidence?.reviewCandidate) {
      throw new BadRequestException({ code: 'review_candidate_not_recorded' });
    }
    return this.normalizeCandidate(evidence.reviewCandidate);
  }

  private normalizeCandidate(
    candidate: SupervisorReviewCandidate,
  ): SupervisorReviewCandidate {
    const targetBranch = candidate.targetBranch.trim();
    if (!targetBranch) {
      throw new BadRequestException({ code: 'review_candidate_incomplete' });
    }

    const baseSha = this.requireSha(candidate.baseSha, 'invalid_base_sha');
    const headSha = this.requireSha(candidate.headSha, 'invalid_head_sha');
    const changedFiles = this.normalizeChangedFileSet(candidate.changedFiles);
    if (changedFiles.length === 0) {
      throw new BadRequestException({ code: 'review_candidate_empty_changes' });
    }

    return {
      action: candidate.action,
      targetBranch,
      baseSha,
      headSha,
      changedFiles,
    };
  }

  private requireCandidateMatchesEvidence(
    candidate: SupervisorReviewCandidate,
    evidence: SupervisorEvidence,
  ) {
    const evidenceFiles = this.normalizeChangedFileSet(evidence.changedFiles);
    if (!this.sameStringArray(candidate.changedFiles, evidenceFiles)) {
      throw new BadRequestException({
        code: 'review_candidate_evidence_mismatch',
      });
    }
  }

  private sameCandidate(
    left: SupervisorReviewCandidate,
    right: SupervisorReviewCandidate,
  ) {
    return (
      left.action === right.action &&
      left.targetBranch === right.targetBranch &&
      left.baseSha === right.baseSha &&
      left.headSha === right.headSha &&
      this.sameStringArray(left.changedFiles, right.changedFiles)
    );
  }

  private normalizeChangedFileSet(files: string[]) {
    return Array.from(
      new Set(files.map((path) => this.normalizeRepoPath(path))),
    ).sort();
  }

  private sameStringArray(left: string[], right: string[]) {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  private validateChangedFiles(allowedPaths: string[], changedFiles: string[]) {
    const normalizedAllowed = allowedPaths.map((path) =>
      this.normalizeAllowedPath(path),
    );
    const normalizedChanged = changedFiles.map((path) =>
      this.normalizeRepoPath(path),
    );

    for (const changedFile of normalizedChanged) {
      if (
        !normalizedAllowed.some((allowed) =>
          this.pathMatches(allowed, changedFile),
        )
      ) {
        throw new BadRequestException({
          code: 'changed_file_out_of_scope',
          path: changedFile,
        });
      }
    }
  }

  private requireSha(value: string, code: string) {
    if (!FULL_GIT_SHA.test(value)) {
      throw new BadRequestException({ code });
    }
    return value.toLowerCase();
  }

  private normalizeAllowedPath(path: string) {
    const trimmed = path.trim().replace(/\\/g, '/');
    const trailingSlash = trimmed.endsWith('/');
    const base = trailingSlash ? trimmed.slice(0, -1) : trimmed;
    const normalized = this.normalizeRepoPath(base);
    return trailingSlash ? `${normalized}/` : normalized;
  }

  private normalizeRepoPath(path: string) {
    const normalized = path.trim().replace(/\\/g, '/');
    if (
      !normalized ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized)
    ) {
      throw new BadRequestException({ code: 'invalid_repo_path' });
    }

    const segments = normalized.split('/');
    if (
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    ) {
      throw new BadRequestException({ code: 'invalid_repo_path' });
    }

    return normalized;
  }

  private pathMatches(allowed: string, changed: string) {
    return allowed.endsWith('/')
      ? changed.startsWith(allowed)
      : changed === allowed;
  }

  private allowed(taskId: string, executionId: string): SupervisorGateDecision {
    return {
      allowed: true,
      reason: null,
      taskId,
      executionId,
    };
  }
}
