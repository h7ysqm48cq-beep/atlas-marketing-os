import type {
  SupervisorExecutionPurpose,
  SupervisorWorkerRole,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';

export type SupervisorWorkerCapabilityOperation =
  'read_assignment' | 'mark_running' | 'complete' | 'fail' | 'cancel';

export interface SupervisorWorkerCapabilityMetadata {
  version: 1;
  assignmentDigest: string;
  allowedOperations: SupervisorWorkerCapabilityOperation[];
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisorWorkerCapabilityClaims extends SupervisorWorkerCapabilityMetadata {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
}

export interface SupervisorWorkerCapabilityAuthorizationInput {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
  assignment: WorkerAssignmentEnvelope;
  operation: SupervisorWorkerCapabilityOperation;
  now?: Date;
}
