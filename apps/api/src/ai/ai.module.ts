import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { HistoryModule } from '../history/history.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PromptChainModule } from '../prompt-chain/prompt-chain.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PromptBuilderService } from './prompt-builder.service';

@Module({
  imports: [BrandsModule, HistoryModule, KnowledgeModule, PromptChainModule],
  controllers: [AiController],
  providers: [AiService, PromptBuilderService],
})
export class AiModule {}
