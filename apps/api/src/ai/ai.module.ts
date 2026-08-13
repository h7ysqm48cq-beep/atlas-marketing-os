import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { BrandsModule } from '../brands/brands.module';
import { HistoryModule } from '../history/history.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { PromptChainModule } from '../prompt-chain/prompt-chain.module';
import { BrainModule } from '../brain/brain.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ContentQualityService } from './content-quality.service';
import { AssetContextService } from './asset-context.service';
import { AiBackgroundJobService } from './ai-background-job.service';

@Module({
  imports: [
    AiRuntimeModule,
    BrandsModule,
    HistoryModule,
    KnowledgeModule,
    MemoryModule,
    PromptChainModule,
    BrainModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    PromptBuilderService,
    ContentQualityService,
    AssetContextService,
    AiBackgroundJobService,
  ],
  exports: [PromptBuilderService],
})
export class AiModule {}
