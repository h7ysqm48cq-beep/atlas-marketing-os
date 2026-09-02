import { InternalServerErrorException } from '@nestjs/common';
import type {
  ProductionDeploymentService,
  SupervisorAction,
  SupervisorEvidence,
  SupervisorIntegrationAction,
  SupervisorOwnerDeploymentAuthorization,
  SupervisorOwnerMergeAuthorization,
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

type JsonObject = Record<string, unknown>;

const INTEGRATION_ACTIONS = new Set<SupervisorIntegrationAction>([
  'merge',
  'deploy_production',
  'run_migration',
  'change_runtime_config',
]);
const FULL_SIGNATURE = /^[0-9a-f]{64}$/i;
const PRODUCTION_DEPLOYMENT_SERVICES = new Set<ProductionDeploymentService>([
  'api',
  'web',
  'browser-worker',
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
    signature: requireString(object.signature),
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
  if (
    candidate.action !== 'deploy_production' ||
    candidate.targetBranch !== 'production/atlas' ||
    !PRODUCTION_DEPLOYMENT_SERVICES.has(service) ||
    !authorizedBy.trim() ||
    !authorizedAt.trim() ||
    !FULL_SIGNATURE.test(signature)
  ) {
    throw persistenceError();
  }
  return { candidate, service, authorizedBy, authorizedAt, signature };
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
  const ownerDeploymentAuthorization =
    object.ownerDeploymentAuthorization === undefined
      ? undefined
      : mapOwnerDeploymentAuthorization(object.ownerDeploymentAuthorization);

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
    ...(ownerDeploymentAuthorization ? { ownerDeploymentAuthorization } : {}),
  };
}

function mapAssignment(value: unknown): WorkerAssignmentEnvelope {
  const object = requireObject(value);
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
  };
}
