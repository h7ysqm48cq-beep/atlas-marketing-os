import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BrandsModule } from '../brands/brands.module';
import { AiModule } from '../ai/ai.module';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { StrategyModule } from '../strategy/strategy.module';
import { MemoryModule } from '../memory/memory.module';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotController } from './copilot.controller';
import { CopilotAttachmentService } from './copilot-attachment.service';
import { CopilotBackgroundJobService } from './copilot-background-job.service';
import { CopilotService } from './copilot.service';
import { PromptContextBuilder } from './prompt-context.builder';
import { MarketingPlannerService } from './marketing-planner.service';

@Module({
  imports: [
    StorageModule,
    BrandsModule,
    StrategyModule,
    AiModule,
    AiRuntimeModule,
    KnowledgeModule,
    MemoryModule,
  ],
  controllers: [CopilotController],
  providers: [
    CopilotAttachmentService,
    CopilotService,
    MarketingPlannerService,
    ConversationMemoryService,
    CopilotBackgroundJobService,

    PromptContextBuilder,
  ],
})
export class CopilotModule {}
