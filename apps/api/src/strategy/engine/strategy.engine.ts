import { Injectable } from '@nestjs/common';
import { AudienceEngine } from './audience.engine';
import { GoalEngine } from './goal.engine';
import { IntentEngine } from './intent.engine';
import { KpiEngine } from './kpi.engine';
import { PillarEngine } from './pillar.engine';
import { StrategyResult } from '../types/strategy';

@Injectable()
export class StrategyEngine {
  constructor(
    private readonly intentEngine: IntentEngine,
    private readonly goalEngine: GoalEngine,
    private readonly audienceEngine: AudienceEngine,
    private readonly pillarEngine: PillarEngine,
    private readonly kpiEngine: KpiEngine,
  ) {}

  generate(prompt: string): StrategyResult {
    const intentResult =
      this.intentEngine.classify(prompt);

    const goal = this.goalEngine.select(
      prompt,
      intentResult.intent,
    );

    const audience = this.audienceEngine.resolve(
      prompt,
      intentResult.intent,
    );

    const pillars = this.pillarEngine.generate(
      prompt,
      intentResult.intent,
      goal,
    );

    const kpis = this.kpiEngine.recommend(goal);

    return {
      campaignName: this.buildCampaignName(prompt),
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      goal,
      audience,
      pillars,
      kpis,
      reasoning: [
        intentResult.reason,
        `Selected "${goal}" as the campaign goal.`,
        `Recommended ${audience.length} audience segments.`,
        `Generated ${pillars.length} strategic content pillars.`,
        `Selected KPIs aligned with the ${goal} goal.`,
      ],
    };
  }

  private buildCampaignName(prompt: string): string {
    const normalized = prompt
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return 'Untitled Marketing Strategy';
    }

    return normalized.length > 60
      ? `${normalized.slice(0, 57)}...`
      : normalized;
  }
}
