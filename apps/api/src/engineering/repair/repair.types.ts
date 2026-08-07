export type RepairRequest = {
  error: string;
  filePath: string;
  currentContent: string;
};


export type RepairResult = {
  after: string;
  explanation: string;
  confidence: number;
};
