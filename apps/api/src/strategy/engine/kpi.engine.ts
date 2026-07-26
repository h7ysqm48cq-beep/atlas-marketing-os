import { Injectable } from '@nestjs/common';
import { CampaignGoal } from '../types/goal';

@Injectable()
export class KpiEngine {
  recommend(goal: CampaignGoal): string[] {
    const map: Record<CampaignGoal, string[]> = {
      [CampaignGoal.ENGAGEMENT]: [
        'Comments',
        'Shares',
        'Saves',
        'Engagement Rate',
      ],
      [CampaignGoal.AWARENESS]: [
        'Reach',
        'Impressions',
        'Video Views',
        'Brand Mentions',
      ],
      [CampaignGoal.CONVERSION]: [
        'Click-through Rate',
        'Registrations',
        'Conversion Rate',
        'Cost per Acquisition',
      ],
      [CampaignGoal.RETENTION]: [
        'Returning Users',
        'Repeat Engagement',
        'Reactivation Rate',
        'Retention Rate',
      ],
      [CampaignGoal.COMMUNITY]: [
        'Community Growth',
        'Active Members',
        'Comments',
        'User-generated Content',
      ],
    };

    return map[goal];
  }
}
