export type DashboardCampaign = {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type DashboardIdea = {
  id: string;
  title: string;
  platform: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardHistoryItem = {
  id: string;
  campaignId?: string | null;
  topic?: string;
  status?: string;
  createdAt: string;
  updatedAt?: string;
  platforms?: string[];
};

export type DashboardMemory = {
  learningSampleSize: number;
  approvedCount: number;
  publishedCount: number;
  confidence: number;
  preferredStyle: string | null;
  bestPlatform: string | null;
  bestPostingTime: string | null;
  averageScores: {
    viral: number;
    discussion: number;
    shareability: number;
    brandFit: number;
  };
};

export type DashboardMetrics = {
  ideas: number;
  generated: number;
  approved: number;
  published: number;
  platformCount: number;
  health: number;
};
