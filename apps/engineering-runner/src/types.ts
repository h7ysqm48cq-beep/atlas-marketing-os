export type ExecutionPurpose = 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';

export interface WorkerAssignment {
  executionId: string;
  taskId: string;
  workerRole: string;
  executionPurpose?: ExecutionPurpose;
  objective: string;
  allowedPaths: string[];
  forbiddenActions: string[];
  dependencies: string[];
  acceptance: string[];
  requiredEvidence: string[];
  manifestHash?: string;
  claimEpoch?: number;
  leaseId?: string;
  runnerId?: string;
  workerCapability?: unknown;
}

export interface WorkerExecutionEvidence {
  rootCause: string;
  changedFiles: string[];
  tests: string[];
  build: string;
  regression: string[];
  deploymentState: string;
  gitState: string;
  remainingRisk: string[];
}

export interface WorkerExecutionResult {
  summary: string;
  evidence: WorkerExecutionEvidence;
}

export interface ClaimedExecutionSession {
  assignment: WorkerAssignment;
  purpose: ExecutionPurpose;
  heartbeat(): Promise<unknown>;
  complete(result: WorkerExecutionResult): Promise<unknown>;
  fail(reason: string): Promise<unknown>;
  cancel(reason: string): Promise<unknown>;
}

export interface SupervisorClientLike {
  claimNext(): Promise<ClaimedExecutionSession | null>;
}

export interface AssignmentExecutor {
  execute(
    assignment: WorkerAssignment,
    signal?: AbortSignal,
  ): Promise<WorkerExecutionResult>;
}

export interface WorkspaceInspector {
  listChangedFiles(): Promise<string[]>;
}
