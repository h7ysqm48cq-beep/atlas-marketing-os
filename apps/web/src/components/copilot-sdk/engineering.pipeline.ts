import type {
  CopilotPipeline,
} from "./copilot.types";

export const engineeringCopilotPipeline: CopilotPipeline = {
  id: "atlas-engineering",
  agentType: "engineering",

  eyebrow: "Atlas AI Engineer",

  idleTitle: "Ready to analyse your repository",
  activeTitle: "Atlas is reasoning about the change",
  completedTitle: "Engineering plan ready",
  failedTitle: "Engineering analysis failed",

  stages: [
    {
      id: "intent",
      label: "Understanding Request",
      description:
        "Converting the instruction into a structured engineering intent.",
    },
    {
      id: "repository",
      label: "Scanning Repository",
      description:
        "Finding relevant files, symbols and project boundaries.",
    },
    {
      id: "dependencies",
      label: "Analysing Dependencies",
      description:
        "Checking imports, consumers and shared infrastructure.",
    },
    {
      id: "impact",
      label: "Estimating Impact",
      description:
        "Assessing affected files, risk and regression exposure.",
    },
    {
      id: "planning",
      label: "Building Engineering Plan",
      description:
        "Preparing safe, reviewable implementation steps.",
    },
    {
      id: "preview",
      label: "Preparing Preview",
      description:
        "Creating the proposed workspace change for approval.",
    },
  ],

  emptySuggestions: [
    {
      id: "engineering-example",
      label: "Describe the change",
      detail:
        "Example: Redesign Dashboard and improve the mobile layout.",
      completed: true,
    },
    {
      id: "engineering-safety",
      label: "Changes require approval",
      detail:
        "Atlas will analyse and prepare a plan before modifying code.",
      completed: true,
    },
  ],
};

export const engineeringReviewActions = [
  {
    id: "preview",
    label: "Preview",
    description:
      "Review the proposed repository changes.",
    variant: "secondary",
  },
  {
    id: "approve",
    label: "Approve",
    description:
      "Approve the engineering plan for execution.",
    variant: "primary",
    requiresConfirmation: true,
    confirmationMessage:
      "Approve this engineering plan?",
  },
  {
    id: "reject",
    label: "Reject",
    description:
      "Reject the current engineering plan.",
    variant: "danger",
    requiresConfirmation: true,
    confirmationMessage:
      "Reject this engineering plan?",
  },
  {
    id: "retry",
    label: "Retry Analysis",
    description:
      "Run repository reasoning again.",
    variant: "ghost",
  },
] satisfies import(
  "./copilot.types"
).CopilotPipelineAction[];
