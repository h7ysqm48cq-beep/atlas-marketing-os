export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  brand: {
    name: string;
  };
};

export type CampaignIdea = {
  id: string;
  title: string;
  angle: string;
  hook: string;
  platform: string;
  style: string;
  language: string;
  status: string;
  sortOrder: number;
};

export type CampaignWorkspaceTab =
  | "overview"
  | "strategy"
  | "ideas"
  | "assets";

export type CampaignIdeaGeneratorProps = {
  count: number;
  direction: string;
  language: string;
  style: string;
  platform: string;
  status: string;
  isGenerating: boolean;
  onCountChange: (value: number) => void;
  onDirectionChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onPlatformChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};
