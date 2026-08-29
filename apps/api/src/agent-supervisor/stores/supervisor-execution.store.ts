import type { SupervisorExecution } from '../execution/supervisor-execution.types';

export const SUPERVISOR_EXECUTION_STORE = Symbol('SUPERVISOR_EXECUTION_STORE');

export interface SupervisorExecutionStore {
  listByTask(taskId: string): SupervisorExecution[];
  get(id: string): SupervisorExecution | null;
  create(execution: SupervisorExecution): SupervisorExecution;
  save(execution: SupervisorExecution): SupervisorExecution;
}
