import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  SupervisorAuthorityService,
  canonicalizeAuthorityValue,
} from './authority/supervisor-authority.service';
import type { AuthorityClaims } from './authority/authority.types';
import type {
  CreateSupervisorTaskInput,
  PermissionContext,
  PermissionDecision,
  ProductionDeploymentService,
  SupervisorAction,
  SupervisorAgentRole,
  SupervisorCandidatePublicationReceipt,
  SupervisorEvidence,
  SupervisorMergeAttestation,
  SupervisorOwnerDeploymentAuthorization,
  SupervisorOwnerMergeAuthorization,
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
  SUPERVISOR_EXECUTION_RECOVERY_STORE,
  type SupervisorExecutionRecoveryResult,
  type SupervisorExecutionRecoveryStore,
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
  'verifier',
]);

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SYSTEM_TASK_ID =
  /^ATLAS-SYS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTION_DEPLOYMENT_SERVICES = new Set<ProductionDeploymentService>([
  'api',
  'web',
  'browser-worker',
  'engineering-runner',
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
    private readonly _config?: ConfigService,
    @Optional()
    private readonly authority?: SupervisorAuthorityService,
    @Optional()
    @Inject(SUPERVISOR_EXECUTION_RECOVERY_STORE)
    private readonly recoveryStore?: SupervisorExecutionRecoveryStore,
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
    return this.taskStore.create(
      this.buildTask(this.nextTaskId(now), input, now),
    );
  }

  async createSystemTask(
    id: string,
    input: CreateSupervisorTaskInput,
  ): Promise<SupervisorTask> {
    this.validateCreateInput(input);
    const normalizedId = id.trim();
    if (!SYSTEM_TASK_ID.test(normalizedId)) {
      throw new BadRequestException('system_task_id_invalid');
    }

    const existing = await this.taskStore.get(normalizedId);
    if (existing) {
      this.assertSameTaskDefinition(existing, input);
      return existing;
    }

    const now = new Date();
    const task = this.buildTask(normalizedId, input, now);

    try {
      return await this.taskStore.create(task);
    } catch (error) {
      const raced = await this.taskStore.get(normalizedId);
      if (!raced) {
        throw error;
      }
      this.assertSameTaskDefinition(raced, input);
      return raced;
    }
  }

  async startTask(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['DRAFT', 'BLOCKED']);
    await this.assertDependenciesReady(task);
    await this.assertFilesAvailable(task);

    task.status = 'WORKING';
    task.blockingReason = null;
    task.failureReason = null;
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.persistTaskWithLocks(
      task,
      'acquire',
      expectedUpdatedAt,
    );
  }

  async blockTask(id: string, reason: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['DRAFT', 'WORKING', 'VERIFYING']);
    if (!reason.trim()) {
      throw new BadRequestException('blocking_reason_required');
    }

    task.status = 'BLOCKED';
    task.blockingReason = reason.trim();
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.persistTaskWithLocks(
      task,
      'release',
      expectedUpdatedAt,
    );
  }

  async abortTask(
    id: string,
    reason: string,
  ): Promise<SupervisorExecutionRecoveryResult> {
    const normalizedReason = reason?.trim() ?? '';
    if (!normalizedReason) {
      const exception = new BadRequestException('abort_reason_required');
      Object.assign(exception, { response: 'abort_reason_required' });
      throw exception;
    }

    const recoveryStore =
      this.recoveryStore ??
      (this.lifecycleStore &&
      typeof (this.lifecycleStore as Partial<SupervisorExecutionRecoveryStore>)
        .recoverExecutionAndBlockTask === 'function'
        ? (this.lifecycleStore as unknown as SupervisorExecutionRecoveryStore)
        : undefined);
    if (!recoveryStore) {
      throw new ServiceUnavailableException(
        'supervisor_recovery_store_not_configured',
      );
    }

    const recovered = await recoveryStore.recoverExecutionAndBlockTask({
      source: 'HUMAN_OWNER_ABORT',
      taskId: id,
      reason: normalizedReason,
      now: new Date(),
    });
    if (!recovered) {
      throw new ConflictException({
        code: 'supervisor_abort_rejected',
      });
    }
    return recovered;
  }

  async failTask(id: string, reason: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
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
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.persistTaskWithLocks(
      task,
      'release',
      expectedUpdatedAt,
    );
  }

  async submitImplementation(
    id: string,
    evidence: SupervisorEvidence,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
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
      ...(evidence.candidatePublication
        ? { candidatePublication: this.cloneCandidatePublication(evidence.candidatePublication) }
        : {}),
      ...(evidence.reviewCandidate
        ? { reviewCandidate: this.cloneCandidate(evidence.reviewCandidate) }
        : {}),
    };
    task.status = 'IMPLEMENTED';
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.saveTaskMutationIfUnchanged(
      task,
      expectedUpdatedAt,
    );
  }

  async beginVerification(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['IMPLEMENTED']);
    if (!task.evidence) {
      throw new BadRequestException('implementation_evidence_required');
    }

    task.status = 'VERIFYING';
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.saveTaskMutationIfUnchanged(
      task,
      expectedUpdatedAt,
    );
  }

  async admitExistingCandidateVerification(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['BLOCKED', 'DRAFT']);
    if (task.evidence) {
      throw new BadRequestException('existing_candidate_evidence_must_be_empty');
    }
    await this.assertDependenciesReady(task);
    await this.assertFilesAvailable(task);

    task.status = 'VERIFYING';
    task.blockingReason = null;
    task.failureReason = null;
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.persistTaskWithLocks(task, 'acquire', expectedUpdatedAt);
  }

  async returnToWorking(id: string, reason: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['IMPLEMENTED', 'VERIFYING', 'READY_FOR_REVIEW']);
    if (!reason.trim()) {
      throw new BadRequestException('return_reason_required');
    }

    if (task.evidence?.ownerMergeAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_already_consumed',
      });
    }
    if (task.evidence?.ownerDeploymentAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_already_consumed',
      });
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
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.persistTaskWithLocks(
      task,
      'acquire',
      expectedUpdatedAt,
    );
  }

  async adoptExistingCandidateVerification(
    id: string,
    verifiedEvidence: SupervisorEvidence,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['VERIFYING']);
    if (task.evidence) {
      throw new BadRequestException('existing_candidate_evidence_already_present');
    }
    if (!verifiedEvidence.existingCandidateVerification ||
        !verifiedEvidence.reviewCandidate ||
        verifiedEvidence.candidatePublication) {
      throw new BadRequestException('existing_candidate_verifier_proof_required');
    }
    this.validateEvidence(task, verifiedEvidence);
    // This evidence is explicitly verifier provenance, NEVER implementation.
    task.evidence = structuredClone(verifiedEvidence);
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.saveTaskMutationIfUnchanged(task, expectedUpdatedAt);
  }

  async markReadyForReview(id: string): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['VERIFYING']);
    if (!task.evidence) {
      throw new BadRequestException('verification_evidence_required');
    }

    task.status = 'READY_FOR_REVIEW';
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.persistTaskWithLocks(
      task,
      'release',
      expectedUpdatedAt,
    );
  }

  async approveTask(
    id: string,
    explicitUserApproval: boolean,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['READY_FOR_REVIEW']);
    if (!explicitUserApproval) {
      throw new BadRequestException('explicit_user_approval_required');
    }

    task.status = 'APPROVED';
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.saveTaskMutationIfUnchanged(
      task,
      expectedUpdatedAt,
    );
  }

  async authorizeMerge(
    id: string,
    candidate: SupervisorReviewCandidate,
    authorization: SupervisorOwnerMergeAuthorization,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);

    this.requireStatus(task, ['READY_FOR_REVIEW', 'APPROVED']);

    if (task.evidence?.ownerMergeAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_already_consumed',
      });
    }

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

    const verifiedAuthorization =
      structuredClone(authorization);

    this.verifyOwnerMergeAuthorization(
      verifiedAuthorization,
      requestedCandidate,
    );

    task.evidence = {
      ...task.evidence!,
      ownerMergeAuthorization:
        verifiedAuthorization,
    };

    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.saveTaskIfUnchanged(task, expectedUpdatedAt);
  }

  async consumeMergeAuthorization(
    id: string,
    attestation: SupervisorMergeAttestation,
    consumedBy: string,
  ): Promise<SupervisorTask> {
    return this.consumeMergeAuthorizationAt(
      id,
      attestation,
      consumedBy,
    );
  }

  async consumeTrustedMergeAuthorization(
    id: string,
    attestation: SupervisorMergeAttestation,
    consumedBy: string,
  ): Promise<SupervisorTask> {
    const normalizedAttestation =
      this.normalizeMergeAttestation(attestation);

    return this.consumeMergeAuthorizationAt(
      id,
      normalizedAttestation,
      consumedBy,
      new Date(normalizedAttestation.mergedAt),
    );
  }

  private async consumeMergeAuthorizationAt(
    id: string,
    attestation: SupervisorMergeAttestation,
    consumedBy: string,
    verifiedAt?: Date,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);

    this.requireStatus(task, ['READY_FOR_REVIEW', 'APPROVED']);

    if (task.evidence?.ownerMergeAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_already_consumed',
      });
    }

    const authorization = task.evidence?.ownerMergeAuthorization;

    if (!authorization) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_required',
      });
    }

    this.assertOwnerMergeAuthorization(
      task,
      authorization.candidate,
      verifiedAt,
    );

    const authorizedCandidate = this.normalizeCandidate(
      authorization.candidate,
    );
    const normalizedAttestation =
      this.normalizeMergeAttestation(attestation);

    if (
      normalizedAttestation.mergeParents[0] !==
        authorizedCandidate.baseSha ||
      normalizedAttestation.mergeParents[1] !==
        authorizedCandidate.headSha
    ) {
      throw new BadRequestException({
        code: 'merge_attestation_parent_mismatch',
      });
    }

    const ownerId = consumedBy.trim();

    if (!ownerId) {
      throw new BadRequestException({
        code: 'owner_identity_required',
      });
    }

    const consumedAt = new Date().toISOString();

    const {
      ownerMergeAuthorization: _mergeAuthorization,
      ...evidence
    } = task.evidence!;

    task.evidence = {
      ...evidence,
      ownerMergeAuthorizationConsumption: {
        authorization: structuredClone(authorization),
        attestation: normalizedAttestation,
        consumedBy: ownerId,
        consumedAt,
      },
    };

    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);

    return this.saveTaskIfUnchanged(task, expectedUpdatedAt);
  }

  async authorizeProductionDeployment(
    id: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    authorization: SupervisorOwnerDeploymentAuthorization,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['READY_FOR_REVIEW', 'APPROVED']);
    if (task.evidence?.ownerDeploymentAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_already_consumed',
      });
    }
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

    const verifiedAuthorization =
      structuredClone(authorization);

    this.verifyOwnerDeploymentAuthorization(
      verifiedAuthorization,
      requestedCandidate,
      authorizedService,
    );

    task.evidence = {
      ...task.evidence,
      ownerDeploymentAuthorization:
        verifiedAuthorization,
    };
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.saveTaskMutationIfUnchanged(
      task,
      expectedUpdatedAt,
    );
  }

  async revokeProductionDeploymentAuthorization(
    id: string,
    reason: string,
    revokedBy: string,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['READY_FOR_REVIEW', 'APPROVED']);

    const authorization = task.evidence?.ownerDeploymentAuthorization;

    if (task.evidence?.ownerDeploymentAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_already_consumed',
      });
    }

    if (!authorization) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_not_found',
      });
    }

    const revocationReason = reason.trim();
    if (!revocationReason) {
      throw new BadRequestException({
        code: 'deployment_authorization_revocation_reason_required',
      });
    }

    const ownerId = revokedBy.trim();
    if (!ownerId) {
      throw new BadRequestException({
        code: 'owner_identity_required',
      });
    }

    const revokedAt = new Date().toISOString();

    const {
      ownerDeploymentAuthorization: _deploymentAuthorization,
      ...evidence
    } = task.evidence!;

    task.evidence = {
      ...evidence,
      ownerDeploymentAuthorizationRevocations: [
        ...(evidence.ownerDeploymentAuthorizationRevocations ?? []),
        {
          candidate: this.cloneCandidate(authorization.candidate),
          service: authorization.service,
          authorizedBy: authorization.authorizedBy,
          authorizedAt: authorization.authorizedAt,
          revokedBy: ownerId,
          revokedAt,
          reason: revocationReason,
        },
      ],
    };

    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.saveTaskMutationIfUnchanged(
      task,
      expectedUpdatedAt,
    );
  }

  async consumeProductionDeploymentAuthorization(
    id: string,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
    consumedBy: string,
  ): Promise<SupervisorTask> {
    const task = await this.requireTask(id);
    const expectedUpdatedAt = new Date(task.updatedAt);
    this.requireStatus(task, ['APPROVED']);

    if (task.evidence?.ownerDeploymentAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_already_consumed',
      });
    }

    const authorization = task.evidence?.ownerDeploymentAuthorization;
    if (!authorization) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_required',
      });
    }

    const claims = this.verifyOwnerDeploymentAuthorization(
      authorization,
      candidate,
      service,
    );
    const consumer = consumedBy.trim();
    if (!consumer) {
      throw new BadRequestException({ code: 'owner_identity_required' });
    }
    if (
      typeof claims.jti !== 'string' ||
      !claims.jti.trim() ||
      typeof claims.candidateHash !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(claims.candidateHash)
    ) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_invalid',
      });
    }

    task.evidence = {
      ...task.evidence!,
      ownerDeploymentAuthorizationConsumption: {
        authorization: structuredClone(authorization),
        approvalJti: claims.jti,
        candidateHash: claims.candidateHash,
        environment: 'production',
        consumedBy: consumer,
        consumedAt: new Date().toISOString(),
      },
    };
    task.updatedAt = this.nextMutationTime(expectedUpdatedAt);
    return this.saveTaskIfUnchanged(task, expectedUpdatedAt);
  }

  assertOwnerMergeAuthorization(
    task: SupervisorTask,
    candidate: SupervisorReviewCandidate,
    verifiedAt?: Date,
  ): void {
    const requestedCandidate = this.normalizeCandidate(candidate);
    this.requireCanonicalMerge(requestedCandidate);

    const authorization = task.evidence?.ownerMergeAuthorization;
    if (!authorization) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_required',
      });
    }

    if (task.evidence?.ownerMergeAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_already_consumed',
      });
    }
    if (task.evidence?.ownerDeploymentAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_already_consumed',
      });
    }

    this.verifyOwnerMergeAuthorization(
      authorization,
      requestedCandidate,
      verifiedAt,
    );
  }

  private verifyOwnerMergeAuthorization(
    authorization: NonNullable<
      SupervisorEvidence['ownerMergeAuthorization']
    >,
    candidate: SupervisorReviewCandidate,
    verifiedAt?: Date,
  ): void {
    const authorizedCandidate =
      this.normalizeCandidate(
        authorization.candidate,
      );

    if (
      !this.sameCandidate(
        authorizedCandidate,
        candidate,
      )
    ) {
      throw new BadRequestException({
        code:
          'owner_merge_authorization_mismatch',
      });
    }

    const authorizedBy =
      authorization.authorizedBy;

    const authorizedAt =
      authorization.authorizedAt;

    const signature =
      authorization.signature;

    if (
      !authorizedBy ||
      authorizedBy !== authorizedBy.trim() ||
      !authorizedAt ||
      authorizedAt !== authorizedAt.trim() ||
      !signature ||
      signature !== signature.trim()
    ) {
      throw new BadRequestException({
        code:
          'owner_merge_authorization_invalid',
      });
    }

    const expectedCandidateHash =
      this.candidateHash(
        authorizedCandidate,
      );

    try {
      const claims =
        this.requireAuthority().verify(
          signature,
          {
            domain: 'MERGE_APPROVAL',
            audience: 'atlas:merge-gate',
            actorType: 'HUMAN_OWNER',
            tokenType: 'MERGE_APPROVAL',
            purpose: 'APPROVE_MERGE',
            candidateHash:
              expectedCandidateHash,
            ...(verifiedAt ? { now: verifiedAt } : {}),
          },
        );

      if (
        claims.authorizedBy !==
          authorizedBy ||
        claims.authorizedAt !==
          authorizedAt ||
        claims.candidateHash !==
          expectedCandidateHash
      ) {
        throw new Error(
          'candidate_binding_mismatch',
        );
      }
    } catch {
      throw new BadRequestException({
        code:
          'owner_merge_authorization_invalid',
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

    this.verifyOwnerDeploymentAuthorization(
      authorization,
      requestedCandidate,
      requestedService,
    );
  }

  private verifyOwnerDeploymentAuthorization(
    authorization: NonNullable<SupervisorEvidence['ownerDeploymentAuthorization']>,
    candidate: SupervisorReviewCandidate,
    service: ProductionDeploymentService,
  ): AuthorityClaims {
    const requestedCandidate = this.normalizeCandidate(candidate);
    const authorizedCandidate = this.normalizeCandidate(authorization.candidate);
    this.requireCanonicalProductionDeployment(authorizedCandidate);
    if (!this.sameCandidate(authorizedCandidate, requestedCandidate)) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_mismatch',
      });
    }
    const authorizedService = this.requireProductionDeploymentService(
      authorization.service,
    );
    if (authorizedService !== service) {
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
      signature !== signature.trim()
    ) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_invalid',
      });
    }
    try {
      const claims = this.requireAuthority().verify(signature, {
        domain: 'DEPLOY_APPROVAL',
        audience: 'atlas:deploy-gate',
        actorType: 'HUMAN_OWNER',
        tokenType: 'DEPLOY_APPROVAL',
        purpose: 'APPROVE_DEPLOY',
      });
      if (
        claims.authorizedBy !== authorizedBy ||
        claims.authorizedAt !== authorizedAt ||
        claims.service !== authorizedService ||
        claims.candidateHash !== this.candidateHash(authorizedCandidate)
      ) {
        throw new Error('candidate_binding_mismatch');
      }
      return claims;
    } catch {
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

    if (role === 'verifier') {
      if (['read_repo', 'search_repo', 'run_tests', 'run_build'].includes(action)) {
        return { allowed: true, reason: null };
      }
      return { allowed: false, reason: 'verifier_read_only' };
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
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask> {
    if (this.lifecycleStore) {
      const saved =
        await this.lifecycleStore.saveWithLocksIfUnchanged(
          task,
          mode,
          expectedUpdatedAt,
        );

      if (saved) {
        return saved;
      }

      throw new ConflictException({
        code: 'supervisor_task_version_conflict',
      });
    }

    const saved = await this.taskStore.saveIfUnchanged(
      task,
      expectedUpdatedAt,
    );

    if (!saved) {
      throw new ConflictException({
        code: 'supervisor_task_version_conflict',
      });
    }

    if (mode === 'acquire') {
      await this.acquireFileOwnership(saved);
    } else {
      await this.releaseFileOwnership(saved.id);
    }

    return saved;
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
    if (evidence.candidatePublication) {
      const receipt = evidence.candidatePublication;
      const fullSha = /^[0-9a-f]{40}$/;
      if (receipt.remoteVerified !== true) {
        throw new BadRequestException({ code: 'candidate_publication_not_verified' });
      }
      if (
        !fullSha.test(receipt.baseSha) ||
        !fullSha.test(receipt.headSha) ||
        !fullSha.test(receipt.remoteHeadSha) ||
        receipt.remoteHeadSha !== receipt.headSha ||
        receipt.targetBranch !== 'production/atlas' ||
        !Array.isArray(receipt.changedFiles) ||
        receipt.changedFiles.some((path) => typeof path !== 'string' || !path.trim())
      ) {
        throw new BadRequestException({ code: 'candidate_publication_invalid' });
      }
      if (receipt.taskId !== task.id) {
        throw new BadRequestException({ code: 'candidate_publication_task_mismatch' });
      }
      const receiptFiles = [...new Set(receipt.changedFiles)].sort();
      const evidenceFiles = [...new Set(evidence.changedFiles)].sort();
      if (
        receiptFiles.length !== evidenceFiles.length ||
        receiptFiles.some((path, index) => path !== evidenceFiles[index])
      ) {
        throw new BadRequestException({ code: 'candidate_publication_changed_files_mismatch' });
      }
      const review = evidence.reviewCandidate;
      const reviewFiles = review ? [...new Set(review.changedFiles)].sort() : [];
      if (
        !review ||
        review.action !== 'merge' ||
        review.targetBranch !== receipt.targetBranch ||
        review.baseSha !== receipt.baseSha ||
        review.headSha !== receipt.headSha ||
        reviewFiles.length !== receiptFiles.length ||
        reviewFiles.some((path, index) => path !== receiptFiles[index])
      ) {
        throw new BadRequestException({
          code: 'candidate_publication_review_candidate_mismatch',
        });
      }
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

  private cloneCandidatePublication(
    receipt: SupervisorCandidatePublicationReceipt,
  ): SupervisorCandidatePublicationReceipt {
    return {
      ...receipt,
      changedFiles: [...receipt.changedFiles],
    };
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

  private requireAuthority(): SupervisorAuthorityService {
    if (!this.authority) {
      throw new BadRequestException({
        code: 'owner_approval_signer_not_configured',
      });
    }
    return this.authority;
  }

  private candidateHash(candidate: SupervisorReviewCandidate): string {
    return createHash('sha256')
      .update(canonicalizeAuthorityValue(candidate), 'utf8')
      .digest('hex');
  }

  private normalizeMergeAttestation(
    attestation: SupervisorMergeAttestation,
  ): SupervisorMergeAttestation {
    const pullRequestNumber = attestation?.pullRequestNumber;

    if (
      !Number.isInteger(pullRequestNumber) ||
      pullRequestNumber <= 0
    ) {
      throw new BadRequestException({
        code: 'merge_attestation_invalid',
      });
    }

    const mergeCommitSha = this.requireSha(
      attestation?.mergeCommitSha,
      'merge_attestation_invalid',
    );

    if (
      !Array.isArray(attestation?.mergeParents) ||
      attestation.mergeParents.length !== 2
    ) {
      throw new BadRequestException({
        code: 'merge_attestation_invalid',
      });
    }

    const mergeParents: [string, string] = [
      this.requireSha(
        attestation.mergeParents[0],
        'merge_attestation_invalid',
      ),
      this.requireSha(
        attestation.mergeParents[1],
        'merge_attestation_invalid',
      ),
    ];

    const mergedAt = attestation?.mergedAt?.trim();

    if (!mergedAt) {
      throw new BadRequestException({
        code: 'merge_attestation_invalid',
      });
    }

    const mergedDate = new Date(mergedAt);

    if (Number.isNaN(mergedDate.getTime())) {
      throw new BadRequestException({
        code: 'merge_attestation_invalid',
      });
    }

    return {
      pullRequestNumber,
      mergeCommitSha,
      mergeParents,
      mergedAt: mergedDate.toISOString(),
    };
  }

  private nextMutationTime(expectedUpdatedAt: Date): Date {
    return new Date(
      Math.max(
        Date.now(),
        expectedUpdatedAt.getTime() + 1,
      ),
    );
  }

  private async saveTaskMutationIfUnchanged(
    task: SupervisorTask,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask> {
    const saved = await this.taskStore.saveIfUnchanged(
      task,
      expectedUpdatedAt,
    );

    if (saved) {
      return saved;
    }

    throw new ConflictException({
      code: 'supervisor_task_version_conflict',
    });
  }

  private async saveTaskIfUnchanged(
    task: SupervisorTask,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask> {
    const saved = await this.taskStore.saveIfUnchanged(
      task,
      expectedUpdatedAt,
    );

    if (saved) {
      return saved;
    }

    const latest = await this.requireTask(task.id);

    if (latest.evidence?.ownerMergeAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_merge_authorization_already_consumed',
      });
    }
    if (latest.evidence?.ownerDeploymentAuthorizationConsumption) {
      throw new BadRequestException({
        code: 'owner_deployment_authorization_already_consumed',
      });
    }

    throw new ConflictException({
      code: 'supervisor_task_version_conflict',
    });
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

  private buildTask(
    id: string,
    input: CreateSupervisorTaskInput,
    now: Date,
  ): SupervisorTask {
    return {
      id,
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
  }

  private assertSameTaskDefinition(
    task: SupervisorTask,
    input: CreateSupervisorTaskInput,
  ): void {
    const expected = this.buildTask(task.id, input, task.createdAt);
    const definition = (value: SupervisorTask) => ({
      objective: value.objective,
      owner: value.owner,
      allowedPaths: value.allowedPaths,
      forbiddenActions: value.forbiddenActions,
      dependsOn: value.dependsOn,
      acceptance: value.acceptance,
    });

    if (
      canonicalizeAuthorityValue(definition(task)) !==
      canonicalizeAuthorityValue(definition(expected))
    ) {
      throw new ConflictException({
        code: 'system_admission_idempotency_mismatch',
        taskId: task.id,
      });
    }
  }

  private unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
  }
}
