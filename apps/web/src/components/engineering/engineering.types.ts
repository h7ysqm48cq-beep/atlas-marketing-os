import type {
  CopilotRuntimeView,
} from "../copilot-sdk";

export type EngineeringRisk =
  | "low"
  | "medium"
  | "high";

export type EngineeringRelatedFile = {
  file_path: string;
  role:
    | "primary"
    | "style"
    | "page"
    | "layout"
    | "dependency"
    | "shared"
    | "test"
    | "unknown";
  score: number;
  reasons: string[];
  symbols: string[];
};

export type EngineeringImpact = {
  affected_files: number;
  component_files: number;
  style_files: number;
  page_files: number;
  shared_files: number;
  affected_symbols: string[];
};

export type EngineeringPlan = {
  title: string;
  summary: string;
  risk: EngineeringRisk;
  confidence: number;
  related_files: EngineeringRelatedFile[];
  impact: EngineeringImpact;
  recommended_actions: string[];
  requires_approval: boolean;
  warnings: string[];
  executable: boolean;
};

export type EngineeringAnalysisResponse = {
  success: boolean;
  text: string;
  intent: {
    intent_type: string;
    raw_text: string;
    target: string | null;
    confidence: number;
    requires_review: boolean;
    actionable: boolean;
  };
  engineering_plan:
    | EngineeringPlan
    | null;
  engineer_result:
    | Record<string, unknown>
    | null;
  requires_review: boolean;
  executed: boolean;
  error: string | null;
};

export type EngineeringWorkspaceState = {
  response: EngineeringAnalysisResponse | null;
  runtimeView: CopilotRuntimeView;
};
