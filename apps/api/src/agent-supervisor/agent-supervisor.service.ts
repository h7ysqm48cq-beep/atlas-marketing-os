import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateSupervisorTaskInput,
  PermissionContext,
  PermissionDecision,
  ProductionDeploymentService,
  SupervisorAction,
  SupervisorAgentRole,
  SupervisorEvidence,
  SupervisorReviewCandidate,
  SupervisorTask,
  SupervisorTaskStatus,
} from './agent-supervisor.types';
import {
  FILE_OWNERSHIP_STORE,
  type FileOwnershipStore,
} from './stores/file-ownership.store';
import {
  SUPERVISOR_LIFECYCLE_STORE,
  type SupervisorLifecycleStore,
  type SupervisorLockMode,
} from './stores/supervisor-lifecycle.store';
import {
  SUPERVISOR_TASK_STORE,
  type SupervisorTaskStore,
} from './stores/supervisor-task.store';

const PROTECTED_INTEGRATION_ACTIONS = new Set<SupervisorAction>([
  'merge',
  'rebase',
  'squash',
  'cherry_pick',
  'auto_merge',
  'force_push',
  'delete_branch_for_integration',
]);

const BASE_ALLOWED_ACTIONS = new Set<SupervisorAction>([
  'read_repo',
  'search_repo',
  'edit_assigned_files',
  'run_tests',
  'run_build',
  'commit_assigned_branch',
]);

const WORKER_ROLES = new Set<Exclude<SupervisorAgentRole, 'supervisor'>>([
  'engineering',
  'frontend',
  'backend',
  'database',
  'qa',
  'infra',
]);

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const FULL_SIGNATURE = /^[0-9a-f]{64}$/i;
const OWNER_DEPLOYMENT_AUTHORIZATION_PURPOSE =
  'ATLAS_OWNER_DEPLOYMENT_AUTHORIZATION_V1';
const PRODUCTION_DEPLOYMENT_SERVICES = new Set<ProductionDeploymentService>([
  'api',
  'web',
  'browser-worker',
]);

@Injectable()
export class AgentSupervisorService {
  constructor(
    @Inject(SUPERVISOR_TASK_STORE)
    private readonly taskStore: SupervisorTaskStore,
    @Inject(FILE_OWNERSHIP_STORE)
    private readonly fileOwnershipStore: FileOwnershipStore,
    @Optional()
    @Inject(SUPERVISOR_LIFECYCLE_STORE)
    private readonly lifecycleStore?: SupervisorLifecycleStore,
    @Optional()
    private readonly config?: ConfigService,
  ) {}

  async status() {
    const tasks = await this.taskStore.list();
    const workingPaths = tasks
      .filter((task) => task.status === 'WORKING')
      .flatMap((task) => task.allowedPaths.map((path) => ({ task, path })));
    const ownership = await Promise.all(
      workingPaths.map(async ({ task, path }) => ({
        path,
        owned: (await this.fileOwnershipStore.findOwner(path)) === task.id,
      })),
    );
    const lockedFiles = new Set(
      ownership.filter((entry) => entry.owned).map((entry) => entry.path),
    ).size;

    return {
      engine: 'agent-supervisor',
      status: 'ready',
      persistence: 'prisma',
      tasks: tasks.length,
      lockedFiles,
    };
  }

  async listTasks(): Promise<SupervisorTask[]> {
    return this.taskStore.list();
  }

  async getTask(id: string): Promise<SupervisorTask> {
    return this.requireTask(id);
  }

  async createTask(input: CreateSupervisorTaskInput): Promise<SupervisorTask> {
    this.validateCreateInput(input);

    const now = new Date();
    const task: SupervisorTask = {
      id: this.nextTaskId(now),
      objective: input.objective.trim(),
      owner: input.owner,
      status: 'DRAFT',
      allowedPaths: this.unique(input.allowedPaths),
      forbiddenActions: this.unique(input.forbiddenActions),
      dependsOn: this.unique(input.dependsOn),
      acceptance: this.unique(input.acceptance),
      evidence: null,
      blockingReason: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };

    return this.taskStore.create(task);
  }

  async startTask(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['DRAFT', 'BLOCKED']);
    await this.assertDependenciesReady(task);
    await this.assertFilesAvailable(task);

    task.status = 'WORKING';
    task.blockingReason = null;
    task.failureReason = null;
    task.updatedAt = new Date();

    return this.persistTaskWithLocks(task, 'acquire');
  }

  async blockTask(id: string, reason: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['DRAFT', 'WORKING', 'VERIFYING']);
    if (!reason.trim()) {
      throw new BadRequestException('blocking_reason_required');
    }

    task.status = 'BLOCKED';
    task.blockingReason = reason.trim();
    task.updatedAt = new Date();

    return this.persistTaskWithLocks(task, 'release');
  }

  async failTask(id: string, reason: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    if (task.status === 'APPROVED' || task.status === 'FAILED') {
      throw new BadRequestException(
        `invalid_transition:${task.status}->FAILED`,
      );
    }
    if (!reason.trim()) {
      throw new BadRequestException('failure_reason_required');
    }

    task.status = 'FAILED';
    task.failureReason = reason.trim();
    task.updatedAt = new Date();

    return this.persistTaskWithLocks(task, 'release');
  }

  async submitImplementation(
    id: string,
    evidence: SupervisorEvidence,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['WORKING']);
    this.validateEvidence(task, evidence);

    task.evidence = {
      rootCause: evidence.rootCause,
      changedFiles: this.unique(evidence.changedFiles),
      tests: this.unique(evidence.tests),
      build: evidence.build,
      regression: this.unique(evidence.regression),
      deploymentState: evidence.deploymentState,
      gitState: evidence.gitState,
      remainingRisk: this.unique(evidence.remainingRisk),
      ...(evidence.reviewCandidate
        ? { reviewCandidate: this.cloneCandidate(evidence.reviewCandidate) }
        : {}),
    };
    task.status = 'IMPLEMENTED';
    task.updatedAt = new Date();

    return this.taskStore.save(task);
  }

  async beginVerification(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['IMPLEMENTED']);
    if (!task.evidence) {
      throw new BadRequestException('implementation_evidence_required');
    }

    task.status = 'VERIFYING';
    task.updatedAt = new Date();
    return this.taskStore.save(task);
  }

  async returnToWorking(id: string, reason: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['IMPLEMENTED', 'VERIFYING', 'READY_FOR_REVIEW']);
    if (!reason.trim()) {
      throw new BadRequestException('return_reason_required');
    }

    await this.assertDependenciesReady(task);
    await this.assertFilesAvailable(task);
    if (
      task.evidence?.ownerMergeAuthorization ||
      task.evidence?.ownerDeploymentAuthorization
    ) {
      const {
        ownerMergeAuthorization: _mergeAuthorization,
        ownerDeploymentAuthorization: _deploymentAuthorization,
        ...evidence
      } = task.evidence;
      task.evidence = evidence;
    }
    task.status = 'WORKING';
    task.blockingReason = reason.trim();
    task.updatedAt = new Date();

    return this.persistTaskWithLocks(task, 'acquire');
  }

  async markReadyForReview(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['VERIFYING']);
    if (!task.evidence) {
      throw new BadRequestException('verification_evidence_required');
    }

    task.status = 'READY_FOR_REVIEW';
    task.updatedAt = new Date();

    return this.persistTaskWithLocks(task, 'release');
  }

  async approveTask(
    id: string,
    explicitUserApproval: boolean,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['READY_FOR_REVIEW']);
    if (!explicitUserApproval) {
      throw new BadRequestException('explicit_user_approval_required');
    }

    task.status = 'APPROVED';
    task.updatedAt = new Date();
    return this.taskStore.save(task);
  }

  async authorizeMerge(
    id: string,
    candidate: SupervisorReviewCandidate,
    authorizedBy: string,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['READY_FOR_REVIEW', 'APPROVED']);
    if (!task.evidence?.reviewCandidate) {
      throw new BadRequestException({ code: 'review_candidate_not_recorded' });
    }

    const reviewedCandidate = this.normalizeCandidate(
      task.evidence.reviewCandidate,
    );
    const requestedCandidate = this.normalizeCandidate(candidate);
    this.requireCanonicalMerge(requestedCandidate);
    if (!this.sameCandidate(reviewedCandidate, requestedCandidate)) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_candidate_mismatch',
      });
    }

    const ownerId = authorizedBy.trim();
    if (!ownerId) {
      throw new BadRequestException({ code: 'owner_identity_required' });
    }

    const authorizedAt = new Date().toISOString();
    task.evidence = {
      ...task.evidence,
      ownerMergeAuthorization: {
        candidate: requestedCandidate,
        authorizedBy: ownerId,
        authorizedAt,
        signature: this.signOwnerMergeAuthorization(
          requestedCandidate,
          ownerId,
          authorizedAt,
        ),
      },
    };
    task.updatedAt = new Date();
    return this.taskStore.save(task);
  }

  async authorizeProductionDeployment(
    id: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    authorizedBy: string,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    this.requireStatus(task, ['READY_FOR_REVIEW', 'APPROVED']);
    if (!task.evidence?.reviewCandidate) {
      throw new BadRequestException({ code: 'review_candidate_not_recorded' });
    }

    const reviewedCandidate = this.normalizeCandidate(
      task.evidence.reviewCandidate,
    );
    const requestedCandidate = this.normalizeCandidate(candidate);
    this.requireCanonicalProductionDeployment(requestedCandidate);
    if (!this.sameCandidate(reviewedCandidate, requestedCandidate)) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_candidate_mismatch',
      });
    }
    const authorizedService = this.requireProductionDeploymentService(service);

    const ownerId = authorizedBy.trim();
    if (!ownerId) {
      throw new BadRequestException({ code: 'owner_identity_required' });
    }

    const authorizedAt = new Date().toISOString();
    task.evidence = {
      ...task.evidence,
      ownerDeploymentAuthorization: {
        candidate: requestedCandidate,
        service: authorizedService,
        authorizedBy: ownerId,
        authorizedAt,
        signature: this.signOwnerDeploymentAuthorization(
          requestedCandidate,
          authorizedService,
          ownerId,
          authorizedAt,
        ),
      },
    };
    task.updatedAt = new Date();
    return this.taskStore.save(task);
  }

  assertOwnerMergeAuthorization(
    task: SupervisorTask,
    candidate: SupervisorReviewCandidate,
  ): void {
    const requestedCandidate = this.normalizeCandidate(candidate);
    this.requireCanonicalMerge(requestedCandidate);

    const authorization = task.evidence?.ownerMergeAuthorization;
    if (!authorization) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_required',
      });
    }

    const authorizedCandidate = this.normalizeCandidate(
      authorization.candidate,
    );
    if (!this.sameCandidate(authorizedCandidate, requestedCandidate)) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_mismatch',
      });
    }

    const authorizedBy = authorization.authorizedBy;
    const authorizedAt = authorization.authorizedAt;
    const signature = authorization.signature;
    if (
      !authorizedBy ||
      authorizedBy !== authorizedBy.trim() ||
      !authorizedAt ||
      authorizedAt !== authorizedAt.trim() ||
      !signature ||
      signature !== signature.trim() ||
      !FULL_SIGNATURE.test(signature)
    ) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_invalid',
      });
    }

    const expected = this.signOwnerMergeAuthorization(
      authorizedCandidate,
      authorizedBy,
      authorizedAt,
    );
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(signature, 'hex');
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_invalid',
      });
    }
  }

  assertOwnerDeploymentAuthorization(
    task: SupervisorTask,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ): void {
    const requestedCandidate = this.normalizeCandidate(candidate);
    this.requireCanonicalProductionDeployment(requestedCandidate);
    const requestedService = this.requireProductionDeploymentService(service);

    const authorization = task.evidence?.ownerDeploymentAuthorization;
    if (!authorization) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_required',
      });
    }

    const authorizedCandidate = this.normalizeCandidate(
      authorization.candidate,
    );
    this.requireCanonicalProductionDeployment(authorizedCandidate);
    if (!this.sameCandidate(authorizedCandidate, requestedCandidate)) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_mismatch',
      });
    }
    const authorizedService = authorization.service;
    if (!PRODUCTION_DEPLOYMENT_SERVICES.has(authorizedService)) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_invalid',
      });
    }
    if (authorizedService !== requestedService) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_service_mismatch',
      });
    }

    const authorizedBy = authorization.authorizedBy;
    const authorizedAt = authorization.authorizedAt;
    const signature = authorization.signature;
    if (
      !authorizedBy ||
      authorizedBy !== authorizedBy.trim() ||
      !authorizedAt ||
      authorizedAt !== authorizedAt.trim() ||
      !signature ||
      signature !== signature.trim() ||
      !FULL_SIGNATURE.test(signature)
    ) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_invalid',
      });
    }

    const expected = this.signOwnerDeploymentAuthorization(
      authorization.candidate,
      authorizedService,
      authorizedBy,
      authorizedAt,
    );
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(signature, 'hex');
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_invalid',
      });
    }
  }

  checkPermission(
    role: SupervisorAgentRole,
    action: SupervisorAction,
    context: PermissionContext = {},
  ): PermissionDecision {
    if (PROTECTED_INTEGRATION_ACTIONS.has(action)) {
      if (role !== 'supervisor') {
        return { allowed: false, reason: 'worker_protected_action_denied' };
      }
      if (!context.explicitUserAuthorization) {
        return {
          allowed: false,
          reason: 'explicit_user_authorization_required',
        };
      }
      return { allowed: true, reason: null };
    }

    if (action === 'deploy_production') {
      if (role !== 'supervisor' && role !== 'infra') {
        return { allowed: false, reason: 'role_not_allowed' };
      }
      return context.explicitUserAuthorization
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'explicit_user_authorization_required' };
    }

    if (action === 'deploy_non_production') {
      if (role !== 'supervisor' && role !== 'infra') {
        return { allowed: false, reason: 'role_not_allowed' };
      }
      return context.supervisorAuthorization
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'supervisor_authorization_required' };
    }

    if (BASE_ALLOWED_ACTIONS.has(action)) {
      if (role === 'qa' && action === 'edit_assigned_files') {
        return context.taskScopeIncludesAction
          ? { allowed: true, reason: null }
          : { allowed: false, reason: 'test_or_fixture_scope_required' };
      }
      return { allowed: true, reason: null };
    }

    if (action === 'change_database_schema' || action === 'run_migration') {
      if (role !== 'database' && role !== 'supervisor') {
        return { allowed: false, reason: 'database_role_required' };
      }
      return context.taskScopeIncludesAction
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'explicit_task_scope_required' };
    }

    if (action === 'change_runtime_config') {
      if (role !== 'infra' && role !== 'supervisor') {
        return { allowed: false, reason: 'infra_role_required' };
      }
      return context.taskScopeIncludesAction
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'explicit_task_scope_required' };
    }

    if (action === 'change_auth_or_identity') {
      if (!['frontend', 'backend', 'supervisor'].includes(role)) {
        return { allowed: false, reason: 'role_not_allowed' };
      }
      if (!context.taskScopeIncludesAction) {
        return { allowed: false, reason: 'explicit_task_scope_required' };
      }
      if (role !== 'supervisor' && !context.supervisorAuthorization) {
        return { allowed: false, reason: 'supervisor_authorization_required' };
      }
      return { allowed: true, reason: null };
    }

    return { allowed: false, reason: 'default_deny' };
  }

  async dependenciesReady(id: string): Promise<boolean> {
    const task = await this.requireTask(id);
    const dependencies = await Promise.all(
      task.dependsOn.map((dependencyId) => this.taskStore.get(dependencyId)),
    );
    return dependencies.every(
      (dependency) =>
        Boolean(dependency) &&
        (['READY_FOR_REVIEW', 'APPROVED'] as SupervisorTaskStatus[]).includes(
          dependency!.status,
        ),
    );
  }

  async ownsAllowedPaths(id: string): Promise<boolean> {
    const task = await this.requireTask(id);
    const owners = await Promise.all(
      task.allowedPaths.map((path) => this.fileOwnershipStore.findOwner(path)),
    );
    return owners.every((owner) => owner === task.id);
  }

  private async assertDependenciesReady(task: SupervisorTask) {
    const dependencies = await Promise.all(
      task.dependsOn.map(async (dependencyId) => ({
        dependencyId,
        dependency: await this.taskStore.get(dependencyId),
      })),
    );
    const unresolved = dependencies
      .filter(
        ({ dependency }) =>
          !dependency ||
          !(
            ['READY_FOR_REVIEW', 'APPROVED'] as SupervisorTaskStatus[]
          ).includes(dependency.status),
      )
      .map(({ dependencyId }) => dependencyId);

    if (unresolved.length > 0) {
      throw new BadRequestException({
        code: 'dependencies_not_ready',
        unresolved,
      });
    }
  }

  private async assertFilesAvailable(task: SupervisorTask) {
    const ownership = await Promise.all(
      task.allowedPaths.map(async (path) => ({
        path,
        owner: await this.fileOwnershipStore.findOwner(path),
      })),
    );
    const conflicts = ownership.filter(
      (entry): entry is { path: string; owner: string } =>
        Boolean(entry.owner && entry.owner !== task.id),
    );

    if (conflicts.length > 0) {
      throw new ConflictException({
        code: 'file_ownership_conflict',
        conflicts,
      });
    }
  }

  private async persistTaskWithLocks(
    task: SupervisorTask,
    mode: SupervisorLockMode,
  ): Promise<SupervisorTask> {
    if (this.lifecycleStore) {
      return this.lifecycleStore.saveWithLocks(task, mode);
    }

    if (mode === 'acquire') {
      await this.acquireFileOwnership(task);
    } else {
      await this.releaseFileOwnership(task.id);
    }
    return this.taskStore.save(task);
  }

  private async acquireFileOwnership(task: SupervisorTask) {
    await this.fileOwnershipStore.acquire(task.id, task.allowedPaths);
  }

  private async releaseFileOwnership(taskId: string) {
    await this.fileOwnershipStore.release(taskId);
  }

  private validateCreateInput(input: CreateSupervisorTaskInput) {
    if (!input.objective?.trim()) {
      throw new BadRequestException('objective_required');
    }
    if (!input.owner || !WORKER_ROLES.has(input.owner)) {
      throw new BadRequestException({ code: 'worker_owner_required' });
    }
    if (!Array.isArray(input.allowedPaths) || input.allowedPaths.length === 0) {
      throw new BadRequestException('allowed_paths_required');
    }
    if (!Array.isArray(input.acceptance) || input.acceptance.length === 0) {
      throw new BadRequestException('acceptance_required');
    }
  }

  private validateEvidence(task: SupervisorTask, evidence: SupervisorEvidence) {
    if (!evidence.rootCause?.trim()) {
      throw new BadRequestException('root_cause_required');
    }
    if (!evidence.deploymentState?.trim()) {
      throw new BadRequestException('deployment_state_required');
    }
    if (!evidence.gitState?.trim()) {
      throw new BadRequestException('git_state_required');
    }

    const outsideScope = evidence.changedFiles.filter(
      (path) => !task.allowedPaths.includes(path),
    );
    if (outsideScope.length > 0) {
      throw new BadRequestException({
        code: 'changed_files_outside_scope',
        paths: outsideScope,
      });
    }
  }

  private normalizeCandidate(
    candidate: SupervisorReviewCandidate,
  ): SupervisorReviewCandidate {
    const targetBranch = candidate.targetBranch?.trim();
    if (!targetBranch || !Array.isArray(candidate.changedFiles)) {
      throw new BadRequestException({ code: 'review_candidate_incomplete' });
    }

    const baseSha = this.requireSha(candidate.baseSha, 'invalid_base_sha');
    const headSha = this.requireSha(candidate.headSha, 'invalid_head_sha');
    const changedFiles = Array.from(
      new Set(
        candidate.changedFiles.map((path) => this.normalizeRepoPath(path)),
      ),
    ).sort();
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

  private cloneCandidate(
    candidate: SupervisorReviewCandidate,
  ): SupervisorReviewCandidate {
    return {
      ...candidate,
      changedFiles: [...candidate.changedFiles],
    };
  }

  private requireCanonicalMerge(candidate: SupervisorReviewCandidate) {
    if (
      candidate.action !== 'merge' ||
      candidate.targetBranch !== 'production/atlas'
    ) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_requires_canonical_merge',
      });
    }
  }

  private requireCanonicalProductionDeployment(
    candidate: SupervisorReviewCandidate,
  ) {
    if (
      candidate.action !== 'deploy_production' ||
      candidate.targetBranch !== 'production/atlas'
    ) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_requires_canonical_deployment',
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
      left.changedFiles.length === right.changedFiles.length &&
      left.changedFiles.every(
        (value, index) => value === right.changedFiles[index],
      )
    );
  }

  private requireSha(value: string, code: string) {
    if (!FULL_GIT_SHA.test(value ?? '')) {
      throw new BadRequestException({ code });
    }
    return value.toLowerCase();
  }

  private normalizeRepoPath(path: string) {
    const normalized = path?.trim().replace(/\\/g, '/');
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

  private signOwnerMergeAuthorization(
    candidate: SupervisorReviewCandidate,
    authorizedBy: string,
    authorizedAt: string,
  ) {
    const token = this.config?.get<string>('ATLAS_SUPERVISOR_OWNER_TOKEN');
    if (!token) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_not_configured',
      });
    }

    return createHmac('sha256', token)
      .update(
        JSON.stringify({
          candidate,
          authorizedBy,
          authorizedAt,
        }),
        'utf8',
      )
      .digest('hex');
  }

  private signOwnerDeploymentAuthorization(
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    authorizedBy: string,
    authorizedAt: string,
  ) {
    const token = this.config?.get<string>('ATLAS_SUPERVISOR_OWNER_TOKEN');
    if (!token) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_not_configured',
      });
    }

    return createHmac('sha256', token)
      .update(
        JSON.stringify({
          purpose: OWNER_DEPLOYMENT_AUTHORIZATION_PURPOSE,
          candidate,
          service,
          authorizedBy,
          authorizedAt,
        }),
        'utf8',
      )
      .digest('hex');
  }

  private requireProductionDeploymentService(
    service: ProductionDeploymentService,
  ): ProductionDeploymentService {
    if (!PRODUCTION_DEPLOYMENT_SERVICES.has(service)) {
      throw new BadRequestException({ code: 'unsupported_production_service' });
    }
    return service;
  }

  private requireStatus(task: SupervisorTask, allowed: SupervisorTaskStatus[]) {
    if (!allowed.includes(task.status)) {
      throw new BadRequestException({
        code: 'invalid_transition',
        current: task.status,
        allowedFrom: allowed,
      });
    }
  }

  private async requireTask(id: string): Promise<SupervisorTask> {
    const task = await this.taskStore.get(id);
    if (!task) {
      throw new NotFoundException(`supervisor_task_not_found:${id}`);
    }
    return task;
  }

  private nextTaskId(now: Date) {
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `ATLAS-${date}-${randomUUID()}`;
  }

  private unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
  }
}
