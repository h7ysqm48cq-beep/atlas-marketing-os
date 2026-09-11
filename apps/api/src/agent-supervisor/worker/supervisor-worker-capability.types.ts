import type {
  SupervisorExecutionPurpose,
  SupervisorWorkerRole,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';

export type SupervisorWorkerCapabilityOperation =
  'read_assignment' | 'mark_running' | 'complete' | 'fail' | 'cancel';

export interface SupervisorWorkerCapabilityMetadata {
  version: 2;
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
  runnerId: string;
  claimEpoch: number;
}

export interface SupervisorWorkerCapabilityAuthorizationInput {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
  assignment: WorkerAssignmentEnvelope;
  operation: SupervisorWorkerCapabilityOperation;
  claimedBy: string | null;
  claimEpoch: number;
  leaseExpiresAt: Date | null;
  now?: Date;
}
