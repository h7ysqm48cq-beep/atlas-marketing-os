import { Module } from '@nestjs/common';
import { AtlasBrainService } from './atlas-brain.service';
import { BrainContextService } from './context.service';
import { IntentService } from './intent.service';
import { PlannerService } from './planner.service';
import { MarketingThinkingService } from './marketing-thinking.service';

@Module({
  providers: [
    AtlasBrainService,
    IntentService,
    BrainContextService,
    PlannerService,
    MarketingThinkingService,
  ],
  exports: [
    AtlasBrainService,
    IntentService,
    BrainContextService,
    PlannerService,
    MarketingThinkingService,
  ],
})
export class BrainModule {}
