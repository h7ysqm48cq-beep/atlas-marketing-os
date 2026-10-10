export type CTORequest = {
  objective: string;
  businessContext?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};


export type CTOAnalysis = {
  objective: string;

  technicalImpact:
    | "LOW"
    | "MEDIUM"
    | "HIGH";

  recommendation: string;

  engineeringTasks: string[];

  risks: string[];

  nextAction: string;
};


export type TechnicalDecision = {
  title: string;

  problem: string;

  decision: string;

  reason: string;

  impact:
    | "LOW"
    | "MEDIUM"
    | "HIGH";

  createdAt: string;
};
