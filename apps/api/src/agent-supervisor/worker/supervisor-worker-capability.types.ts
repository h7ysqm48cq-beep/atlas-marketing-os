import type {
  SupervisorExecutionPurpose,
  SupervisorWorkerRole,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';

export type SupervisorWorkerCapabilityOperation =
  | 'read_assignment'
  | 'mark_running'
  | 'heartbeat'
  | 'complete'
  | 'fail'
  | 'cancel';

export interface SupervisorWorkerCapabilityMetadata {
  version: 2;
  assignmentDigest: string;
  allowedActions: SupervisorWorkerCapabilityOperation[];
  manifestHash: string;
  allowedPaths: string[];
  forbiddenActions: string[];
  claimEpoch: number;
  leaseId: string;
  runnerId: string;
  jti: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisorWorkerCapabilityClaims extends SupervisorWorkerCapabilityMetadata {
  iss: string;
  sub: string;
  aud: string;
  actorType: 'WORKER_EXECUTION';
  tokenType: 'WORKER_CAPABILITY';
  purpose: 'IMPLEMENTATION';
  iat: string;
  exp: string;
  taskId: string;
  executionId: string;
  workerRole: SupervisorWorkerRole;
  executionPurpose: 'IMPLEMENTATION';
  [claim: string]: unknown;
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
