import type { SupervisorTask } from '../agent-supervisor.types';

export const SUPERVISOR_TASK_STORE = Symbol('SUPERVISOR_TASK_STORE');

export interface SupervisorTaskStore {
  list(): SupervisorTask[];
  get(id: string): SupervisorTask | null;
  create(task: SupervisorTask): SupervisorTask;
  save(task: SupervisorTask): SupervisorTask;
}
