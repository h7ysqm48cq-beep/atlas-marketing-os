export type CopilotStage = {
  id: string;
  label: string;
  description: string;
};

export type CopilotMetric = {
  id: string;
  label: string;
  value: number;
  suffix?: string;
};

export type CopilotSuggestion = {
  id: string;
  label: string;
  detail: string;
  completed?: boolean;
  actionLabel?: string;
  actionId?: string;
};

export type CopilotActionVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost";

export type CopilotPipelineAction = {
  id: string;
  label: string;
  description?: string;
  variant?: CopilotActionVariant;
  disabled?: boolean;
  loading?: boolean;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
};

export type CopilotContextItem = {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  tone?:
    | "default"
    | "success"
    | "warning"
    | "danger";
};

export type CopilotContextSection = {
  id: string;
  title: string;
  count?: number;
  items: CopilotContextItem[];
};

export type CopilotDependencyNode = {
  id: string;
  label: string;
  detail?: string;
  role?: string;
};

export type CopilotDependencyEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

export type CopilotDependencyGraph = {
  title: string;
  nodes: CopilotDependencyNode[];
  edges: CopilotDependencyEdge[];
};

export type CopilotEditAction =
  | "create"
  | "modify"
  | "delete"
  | "review";

export type CopilotEditProposal = {
  id: string;
  filePath: string;
  action: CopilotEditAction;
  reason: string;
  risk:
    | "low"
    | "medium"
    | "high";
  approved?: boolean;
};

export type CopilotApprovalState =
  | "DRAFT"
  | "READY"
  | "APPROVED"
  | "APPLYING"
  | "COMPLETED";


export type CopilotDiffLine = {
  type:
    | "add"
    | "remove"
    | "context";
  text: string;
};

export type CopilotDiffPreview = {
  filePath: string;
  lines: CopilotDiffLine[];
};


export type CopilotApplyStatus =
  | "idle"
  | "ready"
  | "applying"
  | "completed"
  | "failed";

export type CopilotGitStatus = {
  branch: string;
  changedFiles: number;
  stagedFiles: number;
  clean: boolean;
};

export type CopilotCommitPlan = {
  message: string;
  summary: string;
  files: string[];
};


export type CopilotCommitStatus =
  | "draft"
  | "ready"
  | "approved"
  | "committing"
  | "completed"
  | "failed";


export type CopilotGitReview = {
  branch: string;
  changedFiles: number;
  stagedFiles: number;
  clean: boolean;
  commitMessage?: string;
  summary?: string;
};


export type CopilotFileChange = {
  id: string;
  filePath: string;
  action:
    | "modify"
    | "create"
    | "delete";
  status: CopilotApplyStatus;
  backupCreated?: boolean;
  message?: string;
};


export type CopilotReasoningStep = {
  id: string;
  title: string;
  detail: string;
  status?:
    | "complete"
    | "active"
    | "pending";
};

export type CopilotPipelineStatus =
  | "idle"
  | "thinking"
  | "completed"
  | "failed";

export type CopilotPipeline = {
  id: string;
  agentType:
    | "marketing"
    | "engineering"
    | "sports"
    | "news"
    | "design"
    | "custom";

  eyebrow: string;

  idleTitle: string;
  activeTitle: string;
  completedTitle: string;
  failedTitle?: string;

  stages: CopilotStage[];

  emptySuggestions?: CopilotSuggestion[];
};

export type CopilotRuntimeView = {
  status: CopilotPipelineStatus;
  statusMessage: string;
  progress?: number;
  activeStage?: number;
  metrics?: CopilotMetric[];
  suggestions?: CopilotSuggestion[];
  contextSections?: CopilotContextSection[];
  dependencyGraph?: CopilotDependencyGraph;
  reasoningSteps?: CopilotReasoningStep[];
  editProposals?: CopilotEditProposal[];
  approvalState?: CopilotApprovalState;
  diffPreviews?: CopilotDiffPreview[];
  fileChanges?: CopilotFileChange[];
  applyStatus?: CopilotApplyStatus;
  gitStatus?: CopilotGitStatus;
  commitPlan?: CopilotCommitPlan;
  gitReview?: CopilotGitReview;
  commitStatus?: CopilotCommitStatus;
};
