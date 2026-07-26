import { CampaignGoal } from './goal';
import { IntentType } from './intent';

export interface StrategyResult {
  campaignName: string;
  intent: IntentType;
  goal: CampaignGoal;
  audience: string[];
  pillars: string[];
  kpis: string[];
}
