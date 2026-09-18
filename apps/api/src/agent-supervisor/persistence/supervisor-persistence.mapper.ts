import { InternalServerErrorException } from '@nestjs/common';
import type {
  ProductionDeploymentService,
  SupervisorAction,
  SupervisorEvidence,
  SupervisorIntegrationAction,
  SupervisorMergeAttestation,
  SupervisorOwnerDeploymentAuthorization,
  SupervisorOwnerDeploymentAuthorizationConsumption,
  SupervisorOwnerDeploymentAuthorizationRevocation,
  SupervisorOwnerMergeAuthorization,
  SupervisorOwnerMergeAuthorizationConsumption,
  SupervisorReviewCandidate,
  SupervisorTask,
  SupervisorTaskStatus,
} from '../agent-supervisor.types';
import type {
  RequiredEvidenceField,
  SupervisorExecution,
  SupervisorExecutionStatus,
  SupervisorWorkerRole,
  WorkerAssignmentEnvelope,
  WorkerExecutionResult,
} from '../execution/supervisor-execution.types';
import type { SupervisorWorkerCapabilityMetadata } from '../worker/supervisor-worker-capability.types';

type JsonObject = Record<string, unknown>;

const INTEGRATION_ACTIONS = new Set<SupervisorIntegrationAction>([
  'merge',
  'deploy_production',
  'run_migration',
  'change_runtime_config',
]);
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const PRODUCTION_DEPLOYMENT_SERVICES = new Set<ProductionDeploymentService>([
  'api',
  'web',
  'browser-worker',
  'engineering-runner',
]);

export interface SupervisorTaskRecord {
  id: string;
  objective: string;
  owner: string;
  status: string;
  allowedPaths: string[];
  forbiddenActions: string[];
  dependsOn: string[];
  acceptance: string[];
  evidence: unknown | null;
  blockingReason: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupervisorExecutionRecord {
  id: string;
  taskId: string;
  workerRole: string;
  status: string;
  assignment: unknown;
  result: unknown | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  runnerId: string | null;
  claimEpoch: number;
  lastHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
}

function persistenceError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'supervisor_persistence_error',
  });
}

function requireObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw persistenceError();
  }
  return value as JsonObject;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw persistenceError();
  }
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw persistenceError();
  }
  return [...value];
}

function requireNullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw persistenceError();
  }
  return value;
}

function requireClaimEpoch(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw persistenceError();
  }
  return value;
}

function requireAuthorityEnvelope(
  value: unknown,
  expectedTokenType: 'MERGE_APPROVAL' | 'DEPLOY_APPROVAL',
): string {
  const signature = requireString(value);
  const parts = signature.split('.');
  if (
    parts.length !== 3 ||
    parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw persistenceError();
  }

  try {
    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const claims = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (
      header.typ !== 'ATLAS_AUTHORITY' ||
      header.alg !== 'EdDSA' ||
      typeof header.kid !== 'string' ||
      claims.tokenType !== expectedTokenType ||
      typeof claims.iss !== 'string' ||
      typeof claims.sub !== 'string' ||
      typeof claims.aud !== 'string' ||
      typeof claims.purpose !== 'string' ||
      typeof claims.iat !== 'string' ||
      typeof claims.exp !== 'string' ||
      typeof claims.jti !== 'string' ||
      typeof claims.claimEpoch !== 'number' ||
      !Number.isInteger(claims.claimEpoch) ||
      claims.claimEpoch < 0
    ) {
      throw persistenceError();
    }
    Buffer.from(parts[2], 'base64url');
  } catch (error) {
    if (error instanceof InternalServerErrorException) throw error;
    throw persistenceError();
  }

  return signature;
}

function requireIntegrationAction(value: unknown): SupervisorIntegrationAction {
  if (
    typeof value !== 'string' ||
    !INTEGRATION_ACTIONS.has(value as SupervisorIntegrationAction)
  ) {
    throw persistenceError();
  }
  return value as SupervisorIntegrationAction;
}

function mapReviewCandidate(value: unknown): SupervisorReviewCandidate {
  const object = requireObject(value);
  return {
    action: requireIntegrationAction(object.action),
    targetBranch: requireString(object.targetBranch),
    baseSha: requireString(object.baseSha),
    headSha: requireString(object.headSha),
    changedFiles: requireStringArray(object.changedFiles),
  };
}

function mapOwnerMergeAuthorization(
  value: unknown,
): SupervisorOwnerMergeAuthorization {
  const object = requireObject(value);
  return {
    candidate: mapReviewCandidate(object.candidate),
    authorizedBy: requireString(object.authorizedBy),
    authorizedAt: requireString(object.authorizedAt),
    signature: requireAuthorityEnvelope(object.signature, 'MERGE_APPROVAL'),
  };
}

function mapMergeAttestation(value: unknown): SupervisorMergeAttestation {
  const object = requireObject(value);

  if (
    typeof object.pullRequestNumber !== 'number' ||
    !Number.isInteger(object.pullRequestNumber) ||
    object.pullRequestNumber <= 0
  ) {
    throw persistenceError();
  }

  const mergeCommitSha = requireString(object.mergeCommitSha);
  const mergeParents = requireStringArray(object.mergeParents);
  const mergedAt = requireString(object.mergedAt);

  if (
    !FULL_GIT_SHA.test(mergeCommitSha) ||
    mergeParents.length !== 2 ||
    mergeParents.some((sha) => !FULL_GIT_SHA.test(sha)) ||
    !mergedAt.trim() ||
    mergedAt !== mergedAt.trim() ||
    Number.isNaN(Date.parse(mergedAt))
  ) {
    throw persistenceError();
  }

  return {
    pullRequestNumber: object.pullRequestNumber,
    mergeCommitSha,
    mergeParents: [mergeParents[0], mergeParents[1]],
    mergedAt,
  };
}

function mapOwnerMergeAuthorizationConsumption(
  value: unknown,
): SupervisorOwnerMergeAuthorizationConsumption {
  const object = requireObject(value);

  const authorization = mapOwnerMergeAuthorization(object.authorization);
  const attestation = mapMergeAttestation(object.attestation);
  const consumedBy = requireString(object.consumedBy);
  const consumedAt = requireString(object.consumedAt);

  if (
    authorization.candidate.action !== 'merge' ||
    authorization.candidate.targetBranch !== 'production/atlas' ||
    !consumedBy.trim() ||
    consumedBy !== consumedBy.trim() ||
    !consumedAt.trim() ||
    consumedAt !== consumedAt.trim() ||
    Number.isNaN(Date.parse(consumedAt))
  ) {
    throw persistenceError();
  }

  return {
    authorization,
    attestation,
    consumedBy,
    consumedAt,
  };
}

function mapOwnerDeploymentAuthorization(
  value: unknown,
): SupervisorOwnerDeploymentAuthorization {
  const object = requireObject(value);
  const candidate = mapReviewCandidate(object.candidate);
  const service = requireString(object.service) as ProductionDeploymentService;
  const authorizedBy = requireString(object.authorizedBy);
  const authorizedAt = requireString(object.authorizedAt);
  const signature = requireString(object.signature);
  requireAuthorityEnvelope(signature, 'DEPLOY_APPROVAL');
  if (
    candidate.action !== 'deploy_production' ||
    candidate.targetBranch !== 'production/atlas' ||
    !PRODUCTION_DEPLOYMENT_SERVICES.has(service) ||
    !authorizedBy.trim() ||
    !authorizedAt.trim()
  ) {
    throw persistenceError();
  }
  return { candidate, service, authorizedBy, authorizedAt, signature };
}

function mapOwnerDeploymentAuthorizationConsumption(
  value: unknown,
): SupervisorOwnerDeploymentAuthorizationConsumption {
  const object = requireObject(value);
  const authorization = mapOwnerDeploymentAuthorization(object.authorization);
  const approvalJti = requireString(object.approvalJti);
  const candidateHash = requireString(object.candidateHash);
  const environment = requireString(object.environment);
  const consumedBy = requireString(object.consumedBy);
  const consumedAt = requireString(object.consumedAt);
  if (
    !/^[0-9a-f]{64}$/i.test(candidateHash) ||
    environment !== 'production' ||
    !approvalJti.trim() ||
    !consumedBy.trim() ||
    consumedBy !== consumedBy.trim() ||
    !consumedAt.trim() ||
    consumedAt !== consumedAt.trim() ||
    Number.isNaN(Date.parse(consumedAt))
  ) {
    throw persistenceError();
  }
  return {
    authorization,
    approvalJti,
    candidateHash,
    environment: 'production',
    consumedBy,
    consumedAt,
  };
}

function mapOwnerDeploymentAuthorizationRevocation(
  value: unknown,
): SupervisorOwnerDeploymentAuthorizationRevocation {
  const object = requireObject(value);
  const candidate = mapReviewCandidate(object.candidate);
  const service = requireString(
    object.service,
  ) as ProductionDeploymentService;
  const authorizedBy = requireString(object.authorizedBy);
  const authorizedAt = requireString(object.authorizedAt);
  const revokedBy = requireString(object.revokedBy);
  const revokedAt = requireString(object.revokedAt);
  const reason = requireString(object.reason);

  if (
    candidate.action !== 'deploy_production' ||
    candidate.targetBranch !== 'production/atlas' ||
    !PRODUCTION_DEPLOYMENT_SERVICES.has(service) ||
    !authorizedBy.trim() ||
    authorizedBy !== authorizedBy.trim() ||
    !authorizedAt.trim() ||
    authorizedAt !== authorizedAt.trim() ||
    Number.isNaN(Date.parse(authorizedAt)) ||
    !revokedBy.trim() ||
    revokedBy !== revokedBy.trim() ||
    !revokedAt.trim() ||
    revokedAt !== revokedAt.trim() ||
    Number.isNaN(Date.parse(revokedAt)) ||
    !reason.trim() ||
    reason !== reason.trim()
  ) {
    throw persistenceError();
  }

  return {
    candidate,
    service,
    authorizedBy,
    authorizedAt,
    revokedBy,
    revokedAt,
    reason,
  };
}

function mapOwnerDeploymentAuthorizationRevocations(
  value: unknown,
): SupervisorOwnerDeploymentAuthorizationRevocation[] {
  if (!Array.isArray(value)) {
    throw persistenceError();
  }

  return value.map(
    mapOwnerDeploymentAuthorizationRevocation,
  );
}

function mapEvidence(value: unknown): SupervisorEvidence {
  const object = requireObject(value);
  const reviewCandidate =
    object.reviewCandidate === undefined
      ? undefined
      : mapReviewCandidate(object.reviewCandidate);
  const ownerMergeAuthorization =
    object.ownerMergeAuthorization === undefined
      ? undefined
      : mapOwnerMergeAuthorization(object.ownerMergeAuthorization);
  const ownerMergeAuthorizationConsumption =
    object.ownerMergeAuthorizationConsumption === undefined
      ? undefined
      : mapOwnerMergeAuthorizationConsumption(
          object.ownerMergeAuthorizationConsumption,
        );
  const ownerDeploymentAuthorization =
    object.ownerDeploymentAuthorization === undefined
      ? undefined
      : mapOwnerDeploymentAuthorization(object.ownerDeploymentAuthorization);
  const ownerDeploymentAuthorizationConsumption =
    object.ownerDeploymentAuthorizationConsumption === undefined
      ? undefined
      : mapOwnerDeploymentAuthorizationConsumption(
          object.ownerDeploymentAuthorizationConsumption,
        );
  const ownerDeploymentAuthorizationRevocations =
    object.ownerDeploymentAuthorizationRevocations === undefined
      ? undefined
      : mapOwnerDeploymentAuthorizationRevocations(
          object.ownerDeploymentAuthorizationRevocations,
        );

  return {
    rootCause: requireString(object.rootCause),
    changedFiles: requireStringArray(object.changedFiles),
    tests: requireStringArray(object.tests),
    build: requireString(object.build),
    regression: requireStringArray(object.regression),
    deploymentState: requireString(object.deploymentState),
    gitState: requireString(object.gitState),
    remainingRisk: requireStringArray(object.remainingRisk),
    ...(reviewCandidate ? { reviewCandidate } : {}),
    ...(ownerMergeAuthorization ? { ownerMergeAuthorization } : {}),
    ...(ownerMergeAuthorizationConsumption
      ? { ownerMergeAuthorizationConsumption }
      : {}),
    ...(ownerDeploymentAuthorization ? { ownerDeploymentAuthorization } : {}),
    ...(ownerDeploymentAuthorizationConsumption
      ? { ownerDeploymentAuthorizationConsumption }
      : {}),
    ...(ownerDeploymentAuthorizationRevocations
      ? { ownerDeploymentAuthorizationRevocations }
      : {}),
  };
}

function mapAssignment(value: unknown): WorkerAssignmentEnvelope {
  const object = requireObject(value);
  const executionPurpose = object.executionPurpose;
  const claimEpoch = object.claimEpoch;
  const workerCapability = object.workerCapability;
  if (
    executionPurpose !== undefined &&
    executionPurpose !== 'IMPLEMENTATION' &&
    executionPurpose !== 'INDEPENDENT_VERIFICATION'
  ) {
    throw persistenceError();
  }
  if (
    claimEpoch !== undefined &&
    (typeof claimEpoch !== 'number' ||
      !Number.isInteger(claimEpoch) ||
      claimEpoch < 0)
  ) {
    throw persistenceError();
  }
  const mappedCapability =
    workerCapability === undefined
      ? undefined
      : mapWorkerCapability(workerCapability);
  return {
    executionId: requireString(object.executionId),
    taskId: requireString(object.taskId),
    workerRole: requireString(object.workerRole) as SupervisorWorkerRole,
    objective: requireString(object.objective),
    allowedPaths: requireStringArray(object.allowedPaths),
    forbiddenActions: requireStringArray(
      object.forbiddenActions,
    ) as SupervisorAction[],
    dependencies: requireStringArray(object.dependencies),
    acceptance: requireStringArray(object.acceptance),
    requiredEvidence: requireStringArray(
      object.requiredEvidence,
    ) as RequiredEvidenceField[],
    ...(executionPurpose !== undefined ? { executionPurpose } : {}),
    ...(object.manifestHash !== undefined
      ? { manifestHash: requireString(object.manifestHash) }
      : {}),
    ...(claimEpoch !== undefined ? { claimEpoch } : {}),
    ...(object.leaseId !== undefined
      ? { leaseId: requireString(object.leaseId) }
      : {}),
    ...(object.runnerId !== undefined
      ? { runnerId: requireString(object.runnerId) }
      : {}),
    ...(mappedCapability ? { workerCapability: mappedCapability } : {}),
  };
}

function mapWorkerCapability(value: unknown): SupervisorWorkerCapabilityMetadata {
  const object = requireObject(value);
  if (object.version !== 2) throw persistenceError();
  const claimEpoch = object.claimEpoch;
  if (
    typeof claimEpoch !== 'number' ||
    !Number.isInteger(claimEpoch) ||
    claimEpoch < 0
  ) {
    throw persistenceError();
  }
  return {
    version: 2,
    assignmentDigest: requireString(object.assignmentDigest),
    allowedActions: requireStringArray(object.allowedActions) as SupervisorWorkerCapabilityMetadata['allowedActions'],
    manifestHash: requireString(object.manifestHash),
    allowedPaths: requireStringArray(object.allowedPaths),
    forbiddenActions: requireStringArray(object.forbiddenActions),
    claimEpoch,
    leaseId: requireString(object.leaseId),
    runnerId: requireString(object.runnerId),
    jti: requireString(object.jti),
    issuedAt: requireString(object.issuedAt),
    expiresAt: requireString(object.expiresAt),
  };
}

function mapResult(value: unknown): WorkerExecutionResult {
  const object = requireObject(value);
  return {
    summary: requireString(object.summary),
    evidence: mapEvidence(object.evidence),
  };
}

export function mapTaskRecord(record: SupervisorTaskRecord): SupervisorTask {
  return {
    id: record.id,
    objective: record.objective,
    owner: record.owner as SupervisorTask['owner'],
    status: record.status as SupervisorTaskStatus,
    allowedPaths: [...record.allowedPaths],
    forbiddenActions: [...record.forbiddenActions] as SupervisorAction[],
    dependsOn: [...record.dependsOn],
    acceptance: [...record.acceptance],
    evidence: record.evidence === null ? null : mapEvidence(record.evidence),
    blockingReason: record.blockingReason,
    failureReason: record.failureReason,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function mapExecutionRecord(
  record: SupervisorExecutionRecord,
): SupervisorExecution {
  return {
    id: record.id,
    taskId: record.taskId,
    workerRole: record.workerRole as SupervisorWorkerRole,
    status: record.status as SupervisorExecutionStatus,
    assignment: mapAssignment(record.assignment),
    result: record.result === null ? null : mapResult(record.result),
    error: record.error,
    createdAt: new Date(record.createdAt),
    startedAt: record.startedAt ? new Date(record.startedAt) : null,
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
    runnerId: requireNullableString(record.runnerId),
    claimEpoch: requireClaimEpoch(record.claimEpoch),
    lastHeartbeatAt: record.lastHeartbeatAt
      ? new Date(record.lastHeartbeatAt)
      : null,
    leaseExpiresAt: record.leaseExpiresAt
      ? new Date(record.leaseExpiresAt)
      : null,
  };
}
