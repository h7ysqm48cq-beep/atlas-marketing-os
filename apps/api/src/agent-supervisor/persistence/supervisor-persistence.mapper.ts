import { InternalServerErrorException } from '@nestjs/common';
import type {
  SupervisorAction,
  SupervisorEvidence,
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
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw persistenceError();
  }
  return [...value];
}

function mapEvidence(value: unknown): SupervisorEvidence {
  const object = requireObject(value);
  return {
    rootCause: requireString(object.rootCause),
    changedFiles: requireStringArray(object.changedFiles),
    tests: requireStringArray(object.tests),
    build: requireString(object.build),
    regression: requireStringArray(object.regression),
    deploymentState: requireString(object.deploymentState),
    gitState: requireString(object.gitState),
    remainingRisk: requireStringArray(object.remainingRisk),
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
