export type ValidationSeverity =
  | 'error'
  | 'warning';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  field: string;
  message: string;
}

export interface ContentValidationResult {
  valid: boolean;
  score: number;
  issues: ValidationIssue[];
}
