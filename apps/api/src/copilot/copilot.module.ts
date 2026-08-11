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
import { CopilotImageController } from './copilot-image/copilot-image.controller';
import { CopilotImageService } from './copilot-image/copilot-image.service';
import { CopilotJobProcessor } from './jobs/copilot-job.processor';
import { AssetImageModule } from '../asset-image/asset-image.module';

@Module({
  imports: [
    StorageModule,
    BrandsModule,
    StrategyModule,
    AiModule,
    KnowledgeModule,
    MemoryModule,
AssetImageModule,
  ],
  controllers: [
  CopilotController,
  CopilotJobController,
  CopilotImageController,
],
  providers: [
    CopilotAttachmentService,
    CopilotService,
    MarketingPlannerService,
    ConversationMemoryService,

    PromptContextBuilder,
  CopilotJobService,
  CopilotImageService,
CopilotJobProcessor,
  ],
})
export class CopilotModule {}
