import { CampaignGoal } from './goal';
import { IntentType } from './intent';

export interface StrategyResult {
  campaignName: string;
  intent: IntentType;
  confidence: number;
  goal: CampaignGoal;
  audience: string[];
  pillars: string[];
  kpis: string[];
  reasoning: string[];
}
