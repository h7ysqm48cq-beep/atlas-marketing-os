import { Injectable } from '@nestjs/common';
import { CampaignGoal } from '../types/goal';
import { IntentType } from '../types/intent';

@Injectable()
export class GoalEngine {
  select(prompt: string, intent: IntentType): CampaignGoal {
    const text = prompt.toLowerCase();

    if (
      text.includes('注册') ||
      text.includes('成交') ||
      text.includes('转化') ||
      text.includes('conversion') ||
      text.includes('sales') ||
      text.includes('deposit') ||
      text.includes('sign up')
    ) {
      return CampaignGoal.CONVERSION;
    }

    if (
      text.includes('留存') ||
      text.includes('回来') ||
      text.includes('复购') ||
      text.includes('retention') ||
      text.includes('reactivation')
    ) {
      return CampaignGoal.RETENTION;
    }

    if (
      text.includes('社群') ||
      text.includes('community') ||
      text.includes('群组') ||
      text.includes('telegram group')
    ) {
      return CampaignGoal.COMMUNITY;
    }

    if (
      text.includes('品牌') ||
      text.includes('曝光') ||
      text.includes('知名度') ||
      text.includes('awareness') ||
      text.includes('reach')
    ) {
      return CampaignGoal.AWARENESS;
    }

    if (
      intent === IntentType.SEO ||
      intent === IntentType.ANALYTICS
    ) {
      return CampaignGoal.AWARENESS;
    }

    return CampaignGoal.ENGAGEMENT;
  }
}
