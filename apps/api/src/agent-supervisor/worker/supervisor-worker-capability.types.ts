import type {
  SupervisorExecutionPurpose,
  SupervisorWorkerRole,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';

export type SupervisorWorkerCapabilityOperation =
  'read_assignment' | 'mark_running' | 'complete' | 'fail' | 'cancel';

export interface SupervisorWorkerCapabilityMetadata {
  version: 1 | 2;
  assignmentDigest: string;
  allowedOperations: SupervisorWorkerCapabilityOperation[];
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisorWorkerCapabilityClaimsV1
  extends SupervisorWorkerCapabilityMetadata {
  version: 1;
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
}

export interface SupervisorWorkerCapabilityClaimsV2
  extends SupervisorWorkerCapabilityMetadata {
  version: 2;
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
  runnerId: string;
  claimEpoch: number;
}

export type SupervisorWorkerCapabilityClaims =
  | SupervisorWorkerCapabilityClaimsV1
  | SupervisorWorkerCapabilityClaimsV2;

export type SupervisorWorkerCapabilityFence = {
  claimedBy: string;
  claimEpoch: number;
  now: Date;
};

export interface SupervisorWorkerCapabilityAuthorizationInput {
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: SupervisorExecutionPurpose;
  assignment: WorkerAssignmentEnvelope;
  operation: SupervisorWorkerCapabilityOperation;
  claimedBy?: string | null;
  claimEpoch?: number;
  leaseExpiresAt?: Date | null;
  now?: Date;
}
