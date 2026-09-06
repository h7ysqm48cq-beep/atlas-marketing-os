import type {
  SupervisorAction,
  SupervisorEvidence,
  SupervisorTask,
} from '../agent-supervisor.types';
import type { SupervisorWorkerCapabilityMetadata } from '../worker/supervisor-worker-capability.types';

export type SupervisorWorkerRole = SupervisorTask['owner'];

export type SupervisorExecutionPurpose =
  'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';

export type SupervisorExecutionStatus =
  'QUEUED' | 'DISPATCHED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type RequiredEvidenceField =
  | 'rootCause'
  | 'changedFiles'
  | 'tests'
  | 'build'
  | 'regression'
  | 'deploymentState'
  | 'gitState'
  | 'remainingRisk';

export interface WorkerAssignmentEnvelope {
  executionId: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose?: SupervisorExecutionPurpose;
  objective: string;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependencies: string[];
  acceptance: string[];
  requiredEvidence: RequiredEvidenceField[];
  workerCapability?: SupervisorWorkerCapabilityMetadata;
}

export interface WorkerExecutionResult {
  evidence: SupervisorEvidence;
  summary: string;
}

export interface SupervisorExecution {
  id: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  status: SupervisorExecutionStatus;
  assignment: WorkerAssignmentEnvelope;
  result: WorkerExecutionResult | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
