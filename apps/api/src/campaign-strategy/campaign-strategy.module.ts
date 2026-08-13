import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { BrandsModule } from '../brands/brands.module';
import { MemoryModule } from '../memory/memory.module';
import { CampaignStrategyController } from './campaign-strategy.controller';
import { CampaignStrategyService } from './campaign-strategy.service';

@Module({
  imports: [AiRuntimeModule, BrandsModule, MemoryModule],
  controllers: [CampaignStrategyController],
  providers: [CampaignStrategyService],
  exports: [CampaignStrategyService],
})
export class CampaignStrategyModule {}
