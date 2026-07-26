import { Module } from '@nestjs/common';
import { AudienceEngine } from './engine/audience.engine';
import { GoalEngine } from './engine/goal.engine';
import { IntentEngine } from './engine/intent.engine';
import { KpiEngine } from './engine/kpi.engine';
import { PillarEngine } from './engine/pillar.engine';
import { StrategyEngine } from './engine/strategy.engine';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';

@Module({
  controllers: [StrategyController],
  providers: [
    IntentEngine,
    GoalEngine,
    AudienceEngine,
    PillarEngine,
    KpiEngine,
    StrategyEngine,
    StrategyService,
  ],
  exports: [
    StrategyEngine,
    StrategyService,
  ],
})
export class StrategyModule {}
