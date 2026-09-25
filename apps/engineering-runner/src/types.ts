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
  frozenBaseSha?: string;
  verificationMode?: 'EXISTING_CANDIDATE' | 'IMPLEMENTATION_RESULT';
  candidateBaseSha?: string;
  candidateHeadSha?: string;
  productionBaselineSha?: string;
  manifestHash?: string;
  claimEpoch?: number;
  leaseId?: string;
  runnerId?: string;
  workerCapability?: unknown;
}


export interface CandidatePublicationReceipt {
  taskId: string;
  executionId: string;
  candidateBranch: string;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  targetBranch: 'production/atlas';
  remoteHeadSha: string;
  remoteVerified: true;
}

export interface WorkerReviewCandidate {
  action: 'merge' | 'deploy_production';
  targetBranch: 'production/atlas';
  baseSha: string;
  headSha: string;
  changedFiles: string[];
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
  candidatePublication?: CandidatePublicationReceipt;
  existingCandidateVerification?: {
    mode: 'EXISTING_CANDIDATE';
    taskId: string; executionId: string;
    baseSha: string; headSha: string; productionBaselineSha: string;
    changedFiles: string[]; gitFingerprint: string; sourceVerified: true;
  };
  reviewCandidate?: WorkerReviewCandidate;
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
  fingerprint?(): Promise<string>;
}
