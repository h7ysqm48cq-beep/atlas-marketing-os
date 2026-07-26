import { AudienceEngine } from './audience.engine';
import { GoalEngine } from './goal.engine';
import { IntentEngine } from './intent.engine';
import { KpiEngine } from './kpi.engine';
import { PillarEngine } from './pillar.engine';
import { StrategyEngine } from './strategy.engine';
import { CampaignGoal } from '../types/goal';
import { IntentType } from '../types/intent';

describe('StrategyEngine', () => {
  const engine = new StrategyEngine(
    new IntentEngine(),
    new GoalEngine(),
    new AudienceEngine(),
    new PillarEngine(),
    new KpiEngine(),
  );

  it('creates a World Cup engagement strategy', () => {
    const result = engine.generate(
      '帮我做世界杯结束后的互动 Campaign',
    );

    expect(result.intent).toBe(
      IntentType.CAMPAIGN_CREATION,
    );
    expect(result.goal).toBe(
      CampaignGoal.ENGAGEMENT,
    );
    expect(result.audience).toContain(
      'Football and sports fans',
    );
    expect(result.pillars).toContain(
      'Football Spirit',
    );
    expect(result.kpis).toContain('Comments');
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('creates a conversion strategy', () => {
    const result = engine.generate(
      '设计一个提高注册转化率的营销活动',
    );

    expect(result.goal).toBe(
      CampaignGoal.CONVERSION,
    );
    expect(result.kpis).toContain(
      'Conversion Rate',
    );
  });

  it('creates a nostalgia audience strategy', () => {
    const result = engine.generate(
      '为马来西亚华人设计港剧怀旧宣传系列',
    );

    expect(result.audience).toContain(
      'Hong Kong entertainment and nostalgia fans',
    );
    expect(result.pillars).toContain('Nostalgia');
  });
});
