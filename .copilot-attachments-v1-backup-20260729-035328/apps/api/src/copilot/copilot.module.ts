import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { StrategyModule } from '../strategy/strategy.module';
import { MemoryModule } from '../memory/memory.module';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { MarketingPlannerService } from './marketing-planner.service';

@Module({
  imports: [
    BrandsModule,
    StrategyModule,
    AiModule,
    KnowledgeModule,
    MemoryModule,
  ],
  controllers: [CopilotController],
  providers: [
    CopilotService,
    MarketingPlannerService,
    ConversationMemoryService,
  ],
})
export class CopilotModule {}
