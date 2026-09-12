import type {
  SupervisorExecution,
  SupervisorExecutionStatus,
  SupervisorWorkerRole,
} from '../execution/supervisor-execution.types';

export const SUPERVISOR_EXECUTION_STORE = Symbol('SUPERVISOR_EXECUTION_STORE');
export const SUPERVISOR_EXECUTION_CLAIM_STORE = Symbol(
  'SUPERVISOR_EXECUTION_CLAIM_STORE',
);
export const SUPERVISOR_EXECUTION_HEARTBEAT_STORE = Symbol(
  'SUPERVISOR_EXECUTION_HEARTBEAT_STORE',
);
export const SUPERVISOR_EXECUTION_RECONCILIATION_STORE = Symbol(
  'SUPERVISOR_EXECUTION_RECONCILIATION_STORE',
);

export interface SupervisorExecutionClaimInput {
  workerRole: SupervisorWorkerRole;
  runnerId: string;
  leaseId: string;
  now: Date;
  leaseExpiresAt: Date;
}

export interface SupervisorExecutionClaimStore {
  claimNext(
    input: SupervisorExecutionClaimInput,
  ): Promise<SupervisorExecution | null>;
}

export interface SupervisorExecutionHeartbeatInput {
  executionId: string;
  taskId: string;
  workerRole: SupervisorWorkerRole;
  claimEpoch: number;
  runnerId: string;
  leaseId: string;
  now: Date;
  leaseExpiresAt: Date;
}

export interface SupervisorExecutionHeartbeatStore {
  heartbeat(
    input: SupervisorExecutionHeartbeatInput,
  ): Promise<SupervisorExecution | null>;
}

export type SupervisorExecutionReconciliationKind =
  | 'QUEUED_TIMEOUT'
  | 'LEGACY_DISPATCHED_TIMEOUT'
  | 'RUNNING_LEASE_EXPIRED';

export interface SupervisorExecutionReconciliationCandidate {
  executionId: string;
  taskId: string;
  status: Extract<SupervisorExecutionStatus, 'QUEUED' | 'DISPATCHED' | 'RUNNING'>;
  kind: SupervisorExecutionReconciliationKind;
  claimEpoch: number;
  runnerId: string | null;
  createdAt: Date;
  leaseExpiresAt: Date | null;
}

export interface SupervisorExecutionReconciliationQuery {
  now: Date;
  queuedBefore: Date;
  limit: number;
}

export interface SupervisorExecutionReconciliationStore {
  findReconciliationCandidates(
    input: SupervisorExecutionReconciliationQuery,
  ): Promise<SupervisorExecutionReconciliationCandidate[]>;
}

export interface SupervisorExecutionStore {
  listByTask(taskId: string): Promise<SupervisorExecution[]>;
  get(id: string): Promise<SupervisorExecution | null>;
  create(execution: SupervisorExecution): Promise<SupervisorExecution>;
  save(execution: SupervisorExecution): Promise<SupervisorExecution>;
  saveIfStatus(
    execution: SupervisorExecution,
    expectedStatus: SupervisorExecutionStatus,
  ): Promise<SupervisorExecution>;
}
