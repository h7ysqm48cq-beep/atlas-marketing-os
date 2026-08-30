import type {
  SupervisorAction,
  SupervisorEvidence,
  SupervisorTask,
} from '../agent-supervisor.types';

export type SupervisorWorkerRole = SupervisorTask['owner'];

export type SupervisorExecutionStatus =
  | 'QUEUED'
  | 'DISPATCHED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

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
  objective: string;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependencies: string[];
  acceptance: string[];
  requiredEvidence: RequiredEvidenceField[];
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
