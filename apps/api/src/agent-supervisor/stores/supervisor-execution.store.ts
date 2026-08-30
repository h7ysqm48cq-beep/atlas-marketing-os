import type { SupervisorExecution } from '../execution/supervisor-execution.types';

export const SUPERVISOR_EXECUTION_STORE = Symbol('SUPERVISOR_EXECUTION_STORE');

export interface SupervisorExecutionStore {
  listByTask(taskId: string): Promise<SupervisorExecution[]>;
  get(id: string): Promise<SupervisorExecution | null>;
  create(execution: SupervisorExecution): Promise<SupervisorExecution>;
  save(execution: SupervisorExecution): Promise<SupervisorExecution>;
}
