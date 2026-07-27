export type MarketingAgentName =
  | 'planner'
  | 'writer'
  | 'reviewer'
  | 'image-director'
  | 'publisher';

export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface AgentExecutionStep {
  agent: MarketingAgentName;
  label: string;
  description: string;
  status: AgentExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  error: string | null;
}

export interface AgentWorkflowInput {
  prompt: string;
  campaignId?: string;
  platforms?: string[];
  language?: string;
  style?: string;
  model?: string;
}

export interface AgentWorkflowState {
  workflowId: string;
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed';
  progress: number;
  currentAgent: MarketingAgentName | null;
  steps: AgentExecutionStep[];
  createdAt: Date;
  completedAt: Date | null;
}

export interface AgentWorkflowResult {
  workflow: AgentWorkflowState;
  contentHistoryId: string | null;
}
