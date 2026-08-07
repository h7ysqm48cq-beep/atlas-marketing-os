import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { HistoryModule } from '../history/history.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { PromptChainModule } from '../prompt-chain/prompt-chain.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ContentQualityService } from './content-quality.service';
import { AiBackgroundJobService } from './ai-background-job.service';

@Module({
  imports: [
    BrandsModule,
    HistoryModule,
    KnowledgeModule,
    MemoryModule,
    PromptChainModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    PromptBuilderService,
    ContentQualityService,
    AiBackgroundJobService,
  ],
  exports: [PromptBuilderService],
})
export class AiModule {}
