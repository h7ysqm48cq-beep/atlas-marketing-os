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
};
