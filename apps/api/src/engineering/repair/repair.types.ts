export type RepairRequest = {
  error: string;

  filePath: string;

  currentContent: string;
};


export type RepairRiskLevel =
  | "low"
  | "medium"
  | "high";


export type RepairResult = {
  after: string;

  explanation:
    string;

  confidence:
    number;

  riskLevel:
    RepairRiskLevel;

  approvalRequired:
    boolean;
};
