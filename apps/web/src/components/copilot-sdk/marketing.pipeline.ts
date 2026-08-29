import type {
  CopilotPipeline,
} from "./copilot.types";

export const marketingCopilotPipeline: CopilotPipeline = {
  id: "atlas-marketing",
  agentType: "marketing",

  eyebrow: "Atlas AI Copilot",

  idleTitle: "Ready to analyse your next idea",
  activeTitle: "Atlas is building your workspace",
  completedTitle: "Workspace analysis complete",

  stages: [
    {
      id: "brand-brain",
      label: "Reading Brand Brain",
      description:
        "Applying voice, rules and positioning.",
    },
    {
      id: "audience",
      label: "Reading Audience",
      description:
        "Matching tone and cultural relevance.",
    },
    {
      id: "campaign",
      label: "Reading Campaign",
      description:
        "Aligning the content with the current objective.",
    },
    {
      id: "platforms",
      label: "Planning Platforms",
      description:
        "Structuring Facebook, Telegram, Instagram, Reels and Image Prompt.",
    },
    {
      id: "writing",
      label: "Writing Content",
      description:
        "Generating platform-specific outputs.",
    },
    {
      id: "scoring",
      label: "Scoring Results",
      description:
        "Reviewing discussion, shareability and brand fit.",
    },
  ],

  emptySuggestions: [
    {
      id: "idle-topic",
      label: "Add a clear topic",
      detail:
        "Enter a focused idea to activate Atlas recommendations.",
      completed: true,
    },
    {
      id: "idle-campaign",
      label: "Link campaign context",
      detail:
        "Campaign context improves strategic alignment.",
      completed: true,
    },
  ],
};
