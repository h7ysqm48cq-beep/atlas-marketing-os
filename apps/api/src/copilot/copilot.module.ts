import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BrandsModule } from '../brands/brands.module';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { StrategyModule } from '../strategy/strategy.module';
import { MemoryModule } from '../memory/memory.module';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotController } from './copilot.controller';
import { CopilotAttachmentService } from './copilot-attachment.service';
import { CopilotService } from './copilot.service';
import { PromptContextBuilder } from './prompt-context.builder';
import { MarketingPlannerService } from './marketing-planner.service';
import { CopilotJobController } from './jobs/copilot-job.controller';
import { CopilotJobService } from './jobs/copilot-job.service';
import { CopilotJobProcessor } from './jobs/copilot-job.processor';

@Module({
  imports: [
    StorageModule,
    BrandsModule,
    StrategyModule,
    AiModule,
    KnowledgeModule,
    MemoryModule,
  ],
  controllers: [
  CopilotController,
  CopilotJobController,
],
  providers: [
    CopilotAttachmentService,
    CopilotService,
    MarketingPlannerService,
    ConversationMemoryService,

    PromptContextBuilder,
  CopilotJobService,
CopilotJobProcessor,
  ],
})
export class CopilotModule {}
