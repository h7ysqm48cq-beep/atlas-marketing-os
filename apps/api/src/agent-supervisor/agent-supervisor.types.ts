export type SupervisorAgentRole =
  | 'supervisor'
  | 'engineering'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'qa'
  | 'infra';

export type SupervisorTaskStatus =
  | 'DRAFT'
  | 'WORKING'
  | 'BLOCKED'
  | 'IMPLEMENTED'
  | 'VERIFYING'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'FAILED';

export type SupervisorAction =
  | 'read_repo'
  | 'search_repo'
  | 'edit_assigned_files'
  | 'run_tests'
  | 'run_build'
  | 'commit_assigned_branch'
  | 'change_database_schema'
  | 'run_migration'
  | 'change_auth_or_identity'
  | 'change_runtime_config'
  | 'deploy_non_production'
  | 'deploy_production'
  | 'merge'
  | 'rebase'
  | 'squash'
  | 'cherry_pick'
  | 'auto_merge'
  | 'force_push'
  | 'delete_branch_for_integration';

export type SupervisorIntegrationAction =
  | 'merge'
  | 'deploy_production'
  | 'run_migration'
  | 'change_runtime_config';

export interface CreateSupervisorTaskInput {
  objective: string;
  owner: Exclude<SupervisorAgentRole, 'supervisor'>;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependsOn: string[];
  acceptance: string[];
}

export interface SupervisorReviewCandidate {
  action: SupervisorIntegrationAction;
  targetBranch: string;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
}

export interface SupervisorOwnerMergeAuthorization {
  candidate: SupervisorReviewCandidate;
  authorizedBy: string;
  authorizedAt: string;
  signature: string;
}

export interface SupervisorEvidence {
  rootCause: string;
  changedFiles: string[];
  tests: string[];
  build: string;
  regression: string[];
  deploymentState: string;
  gitState: string;
  remainingRisk: string[];
  reviewCandidate?: SupervisorReviewCandidate;
  ownerMergeAuthorization?: SupervisorOwnerMergeAuthorization;
}

export interface SupervisorTask {
  id: string;
  objective: string;
  owner: Exclude<SupervisorAgentRole, 'supervisor'>;
  status: SupervisorTaskStatus;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependsOn: string[];
  acceptance: string[];
  evidence: SupervisorEvidence | null;
  blockingReason: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionContext {
  explicitUserAuthorization?: boolean;
  supervisorAuthorization?: boolean;
  taskScopeIncludesAction?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string | null;
}

export type ExternalCodeWorkerKind =
  | 'codex'
  | 'chatgpt-work'
  | 'chatgpt-coding'
  | 'external-agent';

export interface ValidateWorkerContextInput {
  taskId: string;
  executionId: string;
  externalWorker: ExternalCodeWorkerKind;
  changedFiles?: string[];
  requestedAction?: SupervisorAction;
}

export interface IntegrationGateInput {
  taskId: string;
  executionId: string;
  action: SupervisorIntegrationAction;
  targetBranch?: string;
  baseSha?: string;
  headSha?: string;
  changedFiles: string[];
  explicitUserAuthorization: boolean;
}

export interface SupervisorGateDecision {
  allowed: boolean;
  reason: string | null;
  taskId: string;
  executionId: string;
}
