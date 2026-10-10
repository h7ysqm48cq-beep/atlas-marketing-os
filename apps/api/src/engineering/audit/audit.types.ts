export type AuditAction =
  | "recovery_apply"
  | "repair_generate"
  | "validation";


export type EngineeringAuditRecord = {
  action: AuditAction;

  filePath:
    string;

  riskLevel:
    string;

  confidence:
    number;

  approvalState:
    string;

  status:
    string;

  createdAt:
    string;
};
