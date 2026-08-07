export type ValidationStatus =
  | "passed"
  | "failed";


export type ValidationResult = {

  status: ValidationStatus;

  command: string;

  output: string;

  duration: number;

};
