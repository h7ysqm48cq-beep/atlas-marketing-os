import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { BrandsModule } from '../brands/brands.module';
import { PromptChainController } from './prompt-chain.controller';
import { PromptChainService } from './prompt-chain.service';

@Module({
  imports: [BrandsModule, MemoryModule],
  controllers: [PromptChainController],
  providers: [PromptChainService],
  exports: [PromptChainService],
})
export class PromptChainModule {}
