export type RecoveryRequest = {
  error: string;

  command?: string;

  files?: string[];
};


export type RecoveryPatch = {
  filePath: string;
  before?: string;
  after?: string;
};


export type RecoverySuggestion = {
  reason: string;

  files?: string[];

  action:
    | "modify"
    | "create"
    | "review";

  patchRequired?: boolean;

  nextStep?: string;

  patch?: RecoveryPatch[];
};


export type RecoveryResponse = {
  status:
    | "analyzed"
    | "failed";

  analysis: string;

  suggestions:
    RecoverySuggestion[];
};
