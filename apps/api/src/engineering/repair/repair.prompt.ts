export type RepairPromptInput = {
  error: string;
  filePath: string;
  currentContent: string;
};


export function buildRepairPrompt(
  input: RepairPromptInput,
) {

  return `
You are Atlas Engineering Repair Agent.

Task:
Fix the reported software issue safely.

Error:
${input.error}

File:
${input.filePath}

Current Code:
${input.currentContent}

Rules:
- Preserve existing architecture.
- Make the smallest required change.
- Do not remove existing functionality.
- Return only the corrected file content.
`;

}
