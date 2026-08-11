import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AssetImageModule } from '../asset-image/asset-image.module';
import { ImagePromptEngineModule } from '../image-prompt-engine/image-prompt-engine.module';
import { CopilotImageController } from './copilot-image/copilot-image.controller';
import { CopilotImageService } from './copilot-image/copilot-image.service';
import { CopilotJobController } from './jobs/copilot-job.controller';
import { CopilotJobProcessor } from './jobs/copilot-job.processor';
import { CopilotJobService } from './jobs/copilot-job.service';
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
import { PromptContextPipelineService } from './prompt/prompt-context-pipeline.service';
import { MarketingPlannerService } from './marketing-planner.service';
import { CopilotBackgroundJobService } from './copilot-background-job.service';

@Module({
  imports: [
    StorageModule,
    BrandsModule,
    StrategyModule,
    AiModule,
    KnowledgeModule,
    MemoryModule,
AssetImageModule,
ImagePromptEngineModule,
  ],
  controllers: [
CopilotController,
CopilotImageController,
CopilotJobController,
],
  providers: [
    CopilotAttachmentService,
    CopilotService,
    MarketingPlannerService,
    ConversationMemoryService,
    CopilotBackgroundJobService,

CopilotImageService,
CopilotJobService,
CopilotJobProcessor,

    PromptContextBuilder,
    PromptContextPipelineService,
  ],
})
export class CopilotModule {}
