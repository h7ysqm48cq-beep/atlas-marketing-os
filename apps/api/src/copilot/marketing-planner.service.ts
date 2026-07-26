import { Injectable } from '@nestjs/common';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';

export type MarketingPlan = {
  campaignName: string;
  objective: string;
  audience: string;
  hook: string;
  keyMessage: string;
  contentPillars: string[];
  contentIdeas: string[];
  facebook: string[];
  telegram: string[];
  reels: string[];
  imagePrompts: string[];
  schedule: Array<{
    day: number;
    platform: string;
    contentType: string;
    topic: string;
  }>;
};

@Injectable()
export class MarketingPlannerService {
  async generate(
    dto: CreateMarketingPlanDto,
  ): Promise<MarketingPlan> {
    const prompt = dto.prompt.trim();

    return {
      campaignName: prompt || 'Untitled Marketing Campaign',
      objective:
        'Build engagement and create a clear, reusable multi-platform content direction.',
      audience:
        'Primary brand audience based on the active Brand Brain.',
      hook:
        'Turn one strong campaign idea into coordinated Facebook, Telegram and Reels content.',
      keyMessage:
        'Keep the message consistent while adapting the format and tone for each platform.',
      contentPillars: [
        'Engagement',
        'Brand relevance',
        'Platform-native storytelling',
      ],
      contentIdeas: [
        `Introduce the campaign idea: ${prompt}`,
        'Create an interactive discussion post.',
        'Create a short-form video hook.',
        'Create a supporting visual post.',
        'Create a follow-up community question.',
      ],
      facebook: [
        `Facebook draft for: ${prompt}`,
      ],
      telegram: [
        `Telegram draft for: ${prompt}`,
      ],
      reels: [
        `Reels concept for: ${prompt}`,
      ],
      imagePrompts: [
        `Premium cinematic marketing visual for "${prompt}", aligned with the active brand style, clear focal subject, polished commercial composition, platform-ready.`,
      ],
      schedule: [
        {
          day: 1,
          platform: 'Facebook',
          contentType: 'Campaign launch',
          topic: prompt,
        },
        {
          day: 2,
          platform: 'Telegram',
          contentType: 'Short engagement post',
          topic: prompt,
        },
        {
          day: 3,
          platform: 'Reels',
          contentType: 'Short video',
          topic: prompt,
        },
      ],
    };
  }
}
