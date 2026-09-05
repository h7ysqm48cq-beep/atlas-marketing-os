import type { SupervisorTask } from '../agent-supervisor.types';

export const SUPERVISOR_LIFECYCLE_STORE = Symbol('SUPERVISOR_LIFECYCLE_STORE');

export type SupervisorLockMode = 'acquire' | 'release';

export interface SupervisorLifecycleStore {
  saveWithLocksIfUnchanged(
    task: SupervisorTask,
    mode: SupervisorLockMode,
    expectedUpdatedAt: Date,
  ): Promise<SupervisorTask | null>;
}
