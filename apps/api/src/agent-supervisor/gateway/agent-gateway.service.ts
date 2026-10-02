import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  CreateSupervisorTaskInput,
  GithubDeploymentProvenance,
  IntegrationGateInput,
  ProductionDeploymentGateInput,
  ProductionDeploymentResolveInput,
  SupervisorEvidence,
  SupervisorGateDecision,
  SupervisorMergeAttestation,
  SupervisorReviewCandidate,
  SupervisorTask,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import { ProductionDeploymentGateService } from '../deployment/production-deployment-gate.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';

const ACTIVE_IMPLEMENTATION_STATUSES = new Set(['DISPATCHED', 'RUNNING']);
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const PRODUCTION_QUALIFICATION_SERVICES = [
  'engineering-runner',
  'engineering-verifier',
  'browser-worker',
] as const;

const PRODUCTION_DEPLOYMENT_DISPATCH_SERVICES = [
  ...PRODUCTION_QUALIFICATION_SERVICES,
  'production-deploy-executor',
] as const;

export type ProductionDeploymentQualificationService =
  (typeof PRODUCTION_QUALIFICATION_SERVICES)[number];

export type ProductionDeploymentDispatchService =
  (typeof PRODUCTION_DEPLOYMENT_DISPATCH_SERVICES)[number];

export interface ProductionDeploymentQualificationInput {
  service: ProductionDeploymentQualificationService;
  github?: GithubDeploymentProvenance;
}

export interface ProductionDeploymentQualificationResult {
  service: ProductionDeploymentQualificationService;
  commitSha: string;
  taskId: string;
  taskStatus: string;
  executionId: string;
  executionStatus: string;
}

export interface ProductionDeploymentDispatchClaimInput {
  service: ProductionDeploymentDispatchService;
  github?: GithubDeploymentProvenance;
  dispatcherId: string;
}

export interface ProductionDeploymentDispatchClaimResult {
  claimed: boolean;
  reason: null | 'not_found' | 'already_reserved';
  service: ProductionDeploymentDispatchService;
  commitSha: string;
  taskId?: string;
  executionId?: string;
  reservationId?: string;
}

const PRODUCTION_QUALIFICATION_ALLOWED_PATH: Record<
  ProductionDeploymentQualificationService,
  string
> = {
  'engineering-runner':
    'apps/engineering-runner/check-runner-production-deployment.cjs',
  'engineering-verifier':
    'apps/engineering-runner/check-verifier-production-deployment.cjs',
  'browser-worker': 'apps/browser-worker/railway.json',
};

function productionQualificationTaskId(
  service: ProductionDeploymentQualificationService,
  sha: string,
): string {
  const hex = createHash('sha256')
    .update(`production-deployment-qualification:${service}:${sha}`, 'utf8')
    .digest('hex');
  const uuid =
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return `ATLAS-SYS-${uuid}`;
}

function productionDeploymentDispatchReservationId(
  taskId: string,
  service: ProductionDeploymentDispatchService,
  sha: string,
): string {
  const hex = createHash('sha256')
    .update(`production-deployment-dispatch:${taskId}:${service}:${sha}`, 'utf8')
    .digest('hex');
  return `ATLAS-DISPATCH-${hex}`;
}

function productionQualificationTask(
  service: ProductionDeploymentQualificationService,
  sha: string,
): CreateSupervisorTaskInput {
  return {
    objective:
      `zero-git-diff ${service} production qualification for exact canonical production SHA ${sha}. ` +
      'Read-only same-SHA verification only; no source edits, no commit, no deployment, ' +
      'no runtime configuration changes.',
    owner: 'engineering',
    allowedPaths: [PRODUCTION_QUALIFICATION_ALLOWED_PATH[service]],
    forbiddenActions: [
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
    ],
    dependsOn: [],
    acceptance: [
      `baseSha=headSha=${sha}`,
      `service=${service}`,
      'zero git diff',
      'sourceVerified=true',
      'candidatePublication absent',
    ],
  };
}

export type TrustedMergeAuthorizationConsumptionInput = Omit<
  IntegrationGateInput,
  'explicitUserAuthorization'
> & {
  attestation: SupervisorMergeAttestation;
};

@Injectable()
export class AgentGatewayService {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
    private readonly productionDeploymentGate: ProductionDeploymentGateService = new ProductionDeploymentGateService(),
    @Optional()
    private readonly dispatcher?: WorkerDispatcherService,
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
    this.validateCandidatePublicationBinding(task, execution);

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

  async consumeTrustedMergeAuthorization(
    input: TrustedMergeAuthorizationConsumptionInput,
  ): Promise<SupervisorGateDecision> {
    const { task, execution, requestedCandidate } =
      await this.validateIntegrationCandidate({
        ...input,
        explicitUserAuthorization: false,
      });

    if (requestedCandidate.action !== 'merge') {
      throw new BadRequestException({
        code: 'trusted_merge_candidate_required',
      });
    }

    if (task.status !== 'APPROVED') {
      throw new BadRequestException({
        code: 'task_not_merge_approved',
      });
    }

    await this.supervisor.consumeTrustedMergeAuthorization(
      task.id,
      input.attestation,
      'ci-gate',
    );

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


  async qualifyProductionDeployment(
    input: ProductionDeploymentQualificationInput,
  ): Promise<ProductionDeploymentQualificationResult> {
    const dispatcher = this.dispatcher;
    if (!dispatcher) {
      throw new BadRequestException({
        code: 'production_deployment_qualification_unavailable',
      });
    }

    if (
      !PRODUCTION_QUALIFICATION_SERVICES.includes(
        input.service as ProductionDeploymentQualificationService,
      )
    ) {
      throw new BadRequestException({
        code: 'production_deployment_qualification_service_unsupported',
      });
    }

    const service = input.service;
    const sha = input.github?.commitSha?.trim().toLowerCase() ?? '';
    if (!FULL_GIT_SHA.test(sha)) {
      throw new BadRequestException({
        code: 'production_deployment_qualification_sha_invalid',
      });
    }

    this.productionDeploymentGate.assertProductionDeployment({
      service,
      supervisorApprovedSha: sha,
      github: input.github,
    });

    const taskId = productionQualificationTaskId(service, sha);
    let task = await this.supervisor.createSystemTask(
      taskId,
      productionQualificationTask(service, sha),
    );

    let executions = await dispatcher.listByTask(taskId);
    if (executions.length > 1) {
      throw new BadRequestException({
        code: 'production_deployment_qualification_execution_cardinality',
        taskId,
      });
    }

    let execution = executions[0];
    if (!execution) {
      if (task.status !== 'DRAFT') {
        throw new BadRequestException({
          code: 'production_deployment_qualification_task_not_admissible',
          taskId,
          status: task.status,
        });
      }
      execution = (
        await dispatcher.dispatchExistingCandidateVerification(taskId, {
          candidateBaseSha: sha,
          candidateHeadSha: sha,
          productionBaselineSha: sha,
          changedPaths: [],
        })
      ).execution;
      task = await this.supervisor.getTask(taskId);
    }

    if (
      execution.assignment.executionPurpose !== 'INDEPENDENT_VERIFICATION' ||
      execution.assignment.verificationMode !== 'EXISTING_CANDIDATE' ||
      execution.assignment.candidateBaseSha !== sha ||
      execution.assignment.candidateHeadSha !== sha ||
      execution.assignment.productionBaselineSha !== sha
    ) {
      throw new BadRequestException({
        code: 'production_deployment_qualification_execution_mismatch',
        taskId,
        executionId: execution.id,
      });
    }

    if (execution.status === 'FAILED') {
      throw new BadRequestException({
        code: 'production_deployment_qualification_verifier_failed',
        taskId,
        executionId: execution.id,
      });
    }

    if (task.status === 'VERIFYING' && execution.status === 'COMPLETED') {
      await dispatcher.adoptExistingCandidateVerification(
        taskId,
        execution.id,
      );
      task = await this.supervisor.markReadyForReview(taskId);
    }

    if (
      !['VERIFYING', 'READY_FOR_REVIEW', 'APPROVED'].includes(task.status)
    ) {
      throw new BadRequestException({
        code: 'production_deployment_qualification_state_invalid',
        taskId,
        status: task.status,
      });
    }

    return {
      service,
      commitSha: sha,
      taskId,
      taskStatus: task.status,
      executionId: execution.id,
      executionStatus: execution.status,
    };
  }

  async claimProductionDeploymentDispatch(
    input: ProductionDeploymentDispatchClaimInput,
  ): Promise<ProductionDeploymentDispatchClaimResult> {
    if (
      !PRODUCTION_DEPLOYMENT_DISPATCH_SERVICES.includes(
        input.service as ProductionDeploymentDispatchService,
      )
    ) {
      throw new BadRequestException({
        code: 'production_deployment_dispatch_service_unsupported',
      });
    }

    const service = input.service;
    const sha = input.github?.commitSha?.trim().toLowerCase() ?? '';
    if (!FULL_GIT_SHA.test(sha)) {
      throw new BadRequestException({
        code: 'production_deployment_dispatch_sha_invalid',
      });
    }

    const dispatcherId = input.dispatcherId?.trim() ?? '';
    if (!dispatcherId || dispatcherId.length > 160) {
      throw new BadRequestException({
        code: 'production_deployment_dispatch_identity_invalid',
      });
    }

    this.productionDeploymentGate.assertProductionDeployment({
      service,
      supervisorApprovedSha: sha,
      github: input.github,
    });

    const matches: Array<{
      task: SupervisorTask;
      candidate: SupervisorReviewCandidate;
      execution: SupervisorExecution;
    }> = [];

    for (const task of await this.supervisor.listTasks()) {
      if (task.status !== 'APPROVED') continue;
      const rawCandidate = task.evidence?.reviewCandidate;
      if (
        !rawCandidate ||
        rawCandidate.action !== 'deploy_production' ||
        rawCandidate.targetBranch !== 'production/atlas'
      ) {
        continue;
      }

      const candidate = this.normalizeCandidate(rawCandidate);
      if (
        candidate.headSha !== sha ||
        candidate.baseSha !== sha ||
        candidate.changedFiles.length !== 0
      ) {
        continue;
      }
      if (
        task.evidence?.ownerDeploymentAuthorization?.service !== service ||
        task.evidence?.ownerDeploymentAuthorizationConsumption
      ) {
        continue;
      }

      this.supervisor.assertOwnerDeploymentAuthorization(
        task,
        candidate,
        service,
      );

      const executions = await this.executionStore.listByTask(task.id);
      const matchingExecutions = executions.filter((execution) => {
        if (execution.status !== 'COMPLETED' || !execution.result) return false;
        const rawExecutionCandidate =
          execution.result.evidence.reviewCandidate;
        if (!rawExecutionCandidate) return false;
        return this.sameCandidate(
          candidate,
          this.normalizeCandidate(rawExecutionCandidate),
        );
      });

      if (matchingExecutions.length > 1) {
        throw new BadRequestException({
          code: 'production_deployment_dispatch_execution_ambiguous',
          taskId: task.id,
        });
      }
      if (matchingExecutions.length === 0) continue;

      const validated = await this.validatePersistedCandidate(
        task.id,
        matchingExecutions[0].id,
      );
      matches.push({
        task: validated.task,
        candidate: validated.persistedCandidate,
        execution: validated.execution,
      });
    }

    if (matches.length === 0) {
      return {
        claimed: false,
        reason: 'not_found',
        service,
        commitSha: sha,
      };
    }
    if (matches.length > 1) {
      throw new BadRequestException({
        code: 'production_deployment_dispatch_ambiguous',
      });
    }

    const { task, candidate, execution } = matches[0];
    const reservationId = productionDeploymentDispatchReservationId(
      task.id,
      service,
      sha,
    );
    const existingReservation =
      task.evidence?.ownerDeploymentDispatchReservation;
    if (existingReservation) {
      const existingCandidate = this.normalizeCandidate(
        existingReservation.candidate,
      );
      if (
        existingReservation.reservationId === reservationId &&
        existingReservation.reservedBy === dispatcherId &&
        existingReservation.service === service &&
        this.sameCandidate(candidate, existingCandidate)
      ) {
        return {
          claimed: true,
          reason: null,
          service,
          commitSha: sha,
          taskId: task.id,
          executionId: execution.id,
          reservationId,
        };
      }
      return {
        claimed: false,
        reason: 'already_reserved',
        service,
        commitSha: sha,
        taskId: task.id,
        executionId: execution.id,
      };
    }

    await this.supervisor.reserveProductionDeploymentDispatch(
      task.id,
      candidate,
      service,
      reservationId,
      dispatcherId,
    );

    return {
      claimed: true,
      reason: null,
      service,
      commitSha: sha,
      taskId: task.id,
      executionId: execution.id,
      reservationId,
    };
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
        (task.evidence?.ownerDeploymentAuthorization?.service ??
          task.evidence?.ownerDeploymentAuthorizationConsumption?.authorization
            .service) === input.service,
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
    const unconsumedServiceMatches = serviceMatches.filter(
      ({ task }) =>
        !task.evidence?.ownerDeploymentAuthorizationConsumption,
    );
    if (unconsumedServiceMatches.length > 1) {
      throw new BadRequestException({
        code: 'production_deployment_resolution_ambiguous',
      });
    }

    const resolvableMatches =
      unconsumedServiceMatches.length === 1
        ? unconsumedServiceMatches
        : serviceMatches;
    if (resolvableMatches.length > 1) {
      throw new BadRequestException({
        code: 'production_deployment_resolution_ambiguous',
      });
    }

    const { task, candidate } = resolvableMatches[0];
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
    await this.supervisor.consumeProductionDeploymentAuthorization(
      task.id,
      candidate,
      input.service,
      'deploy-gate',
    );
    return this.allowed(validated.task.id, validated.execution.id);
  }

  private validateCandidatePublicationBinding(
    task: SupervisorTask,
    execution: SupervisorExecution,
  ): void {
    const frozenBaseSha = execution.assignment.frozenBaseSha?.trim().toLowerCase();
    const receipt = execution.result?.evidence.candidatePublication;

    if (!frozenBaseSha) {
      if (receipt) {
        throw new BadRequestException({
          code: 'candidate_publication_frozen_base_required',
        });
      }
      return;
    }

    if (!receipt) {
      const changedFiles =
        execution.result?.evidence.changedFiles ?? [];
      if (changedFiles.length === 0) {
        return;
      }
      throw new BadRequestException({
        code: 'candidate_publication_required_for_frozen_base',
      });
    }

    const expectedBranch = `atlas/candidate/${task.id}/${execution.id}`;
    if (
      receipt.taskId !== task.id ||
      receipt.executionId !== execution.id ||
      receipt.baseSha.toLowerCase() !== frozenBaseSha ||
      receipt.candidateBranch !== expectedBranch
    ) {
      throw new BadRequestException({
        code: 'candidate_publication_execution_binding_mismatch',
      });
    }
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
      !['production/atlas', 'main'].includes(requestedCandidate.targetBranch)
    ) {
      throw new BadRequestException({ code: 'governed_target_required' });
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
    this.assertExistingCandidateVerifierProvenance(
      task, execution, taskCandidate,
    );

    return { task, execution, persistedCandidate: taskCandidate };
  }

  private assertExistingCandidateVerifierProvenance(
    task: SupervisorTask,
    execution: SupervisorExecution,
    candidate: SupervisorReviewCandidate,
  ): void {
    const taskProof = task.evidence?.existingCandidateVerification;
    const executionProof = execution.result?.evidence.existingCandidateVerification;
    const assigned = execution.assignment;
    const isExisting = Boolean(taskProof || executionProof ||
      assigned.verificationMode === 'EXISTING_CANDIDATE');
    if (!isExisting) return;
    const fail = () => {
      throw new BadRequestException({
        code: 'existing_candidate_verifier_provenance_invalid',
      });
    };
    const same = (left: string[], right: string[]) =>
      JSON.stringify([...new Set(left)].sort()) ===
      JSON.stringify([...new Set(right)].sort());
    const runtimeRefresh = assigned.candidateBaseSha === assigned.candidateHeadSha;
    const assignedTarget = assigned.targetBranch ?? 'production/atlas';
    const expectedPaths = runtimeRefresh ? [] : task.allowedPaths;
    if (!taskProof || !executionProof ||
        execution.status !== 'COMPLETED' ||
        assigned.executionPurpose !== 'INDEPENDENT_VERIFICATION' ||
        assigned.verificationMode !== 'EXISTING_CANDIDATE' ||
        taskProof.mode !== assigned.verificationMode ||
        executionProof.mode !== assigned.verificationMode ||
        taskProof.sourceVerified !== true ||
        executionProof.sourceVerified !== true ||
        (taskProof.targetBranch ?? 'production/atlas') !== assignedTarget ||
        (executionProof.targetBranch ?? 'production/atlas') !== assignedTarget ||
        taskProof.taskId !== task.id ||
        executionProof.taskId !== task.id ||
        taskProof.executionId !== execution.id ||
        executionProof.executionId !== execution.id ||
        taskProof.baseSha !== assigned.candidateBaseSha ||
        taskProof.headSha !== assigned.candidateHeadSha ||
        taskProof.productionBaselineSha !== assigned.productionBaselineSha ||
        JSON.stringify(taskProof) !== JSON.stringify(executionProof) ||
        !/^[0-9a-f]{64}$/i.test(taskProof.gitFingerprint) ||
        !/^[0-9a-f]{64}$/i.test(assigned.manifestHash ?? '') ||
        !Number.isInteger(assigned.claimEpoch) || assigned.claimEpoch! < 1 ||
        !assigned.runnerId || !assigned.leaseId ||
        !same(taskProof.changedFiles, expectedPaths) ||
        !same(assigned.allowedPaths, task.allowedPaths) ||
        !same(taskProof.changedFiles, candidate.changedFiles) ||
        !same(taskProof.changedFiles,
          execution.result!.evidence.changedFiles) ||
        !same(taskProof.changedFiles,
          task.evidence!.changedFiles) ||
        candidate.action !== (runtimeRefresh ? 'deploy_production' : 'merge') ||
        candidate.targetBranch !== assignedTarget ||
        (runtimeRefresh && assignedTarget !== 'production/atlas') ||
        candidate.baseSha !== taskProof.baseSha ||
        candidate.headSha !== taskProof.headSha ||
        (runtimeRefresh && (taskProof.baseSha !== taskProof.headSha ||
          taskProof.headSha !== taskProof.productionBaselineSha)) ||
        task.evidence!.candidatePublication ||
        execution.result!.evidence.candidatePublication) fail();
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
    const isRuntimeRefresh =
      candidate.action === 'deploy_production' &&
      targetBranch === 'production/atlas' &&
      baseSha === headSha &&
      changedFiles.length === 0;
    if (changedFiles.length === 0 && !isRuntimeRefresh) {
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
