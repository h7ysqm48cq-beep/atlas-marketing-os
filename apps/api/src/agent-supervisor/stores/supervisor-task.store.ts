import type { SupervisorTask } from '../agent-supervisor.types';

export const SUPERVISOR_TASK_STORE = Symbol('SUPERVISOR_TASK_STORE');

export interface SupervisorTaskStore {
  list(): Promise<SupervisorTask[]>;
  get(id: string): Promise<SupervisorTask | null>;
  create(task: SupervisorTask): Promise<SupervisorTask>;
  save(task: SupervisorTask): Promise<SupervisorTask>;
}
