import type { SupervisorTask } from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import type { SupervisorExecutionReconciliationCandidate } from './supervisor-execution.store';

export const SUPERVISOR_LIFECYCLE_STORE = Symbol('SUPERVISOR_LIFECYCLE_STORE');
export const SUPERVISOR_EXECUTION_RECOVERY_STORE = Symbol(
  'SUPERVISOR_EXECUTION_RECOVERY_STORE',
);

export type SupervisorLockMode = 'acquire' | 'release';

export interface ExistingCandidateAtomicAdmission {
  admitExistingCandidateAndQueue(
    currentTask: SupervisorTask,
    execution: SupervisorExecution,
  ): Promise<{ task: SupervisorTask; execution: SupervisorExecution } | null>;
}

export interface SupervisorLifecycleStore {
  saveWithLocksIfUnchanged(
    task: SupervisorTask,
    mode: SupervisorLockMode,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask | null>;
}

export interface SupervisorExecutionReconciliationInput {
  candidate: SupervisorExecutionReconciliationCandidate;
  now: Date;
}

export interface SupervisorExecutionOwnerAbortRecoveryInput {
  source: 'HUMAN_OWNER_ABORT';
  taskId: string;
  reason: string;
  now: Date;
}

export type SupervisorExecutionRecoveryInput =
  | SupervisorExecutionReconciliationInput
  | SupervisorExecutionOwnerAbortRecoveryInput;

export interface SupervisorExecutionRecoveryResult {
  execution: SupervisorExecution;
  task: SupervisorTask;
}

export interface SupervisorExecutionRecoveryStore {
  recoverExecutionAndBlockTask(
    input: SupervisorExecutionRecoveryInput,
  ): Promise<SupervisorExecutionRecoveryResult | null>;
}
