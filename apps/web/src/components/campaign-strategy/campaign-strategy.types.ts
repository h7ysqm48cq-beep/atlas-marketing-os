export type CampaignStrategyResult = {
  campaign: {
    id: string;
    name: string;
  };
  brand: {
    id: string;
    name: string;
  };
  durationDays: number;
  platforms: string[];
  memoryUsed: {
    learningSampleSize: number;
    preferredStyle: string | null;
    bestPlatform: string | null;
    bestPostingTime: string | null;
    confidence: number;
  };
  strategy: {
    campaignSummary: string;
    objective: string;
    audienceStrategy: {
      primaryAudience: string;
      audienceInsight: string;
      motivation: string;
      barrier: string;
    };
    coreMessage: string;
    supportingMessages: string[];
    contentPillars: Array<{
      name: string;
      purpose: string;
      exampleTopics: string[];
    }>;
    platformStrategy: Array<{
      platform: string;
      role: string;
      contentFormat: string;
      frequency: string;
      recommendation: string;
    }>;
    contentMix: Array<{
      category: string;
      percentage: number;
      purpose: string;
    }>;
    callsToAction: string[];
    postingRecommendations: Array<{
      platform: string;
      recommendedTime: string;
      rationale: string;
    }>;
    successMetrics: Array<{
      metric: string;
      targetDirection: string;
      reason: string;
    }>;
    risks: Array<{
      risk: string;
      mitigation: string;
    }>;
    nextActions: string[];
  };
  generatedAt: string;
};

export type StrategyControlsProps = {
  durationDays: number;
  style: string;
  language: string;
  platforms: string[];
  isGenerating: boolean;
  hasResult: boolean;
  message: string;
  onDurationChange: (value: number) => void;
  onStyleChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onTogglePlatform: (platform: string) => void;
  onGenerate: () => void;
};
