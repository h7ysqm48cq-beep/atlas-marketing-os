import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { BrandsModule } from '../brands/brands.module';
import { PromptChainController } from './prompt-chain.controller';
import { PromptChainService } from './prompt-chain.service';
import { QueryUnderstandingService } from './query-understanding.service';

@Module({
  imports: [BrandsModule, MemoryModule, KnowledgeModule],
  controllers: [PromptChainController],
  providers: [PromptChainService, QueryUnderstandingService],
  exports: [PromptChainService],
})
export class PromptChainModule {}
