import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { CampaignPlannerController } from './campaign-planner.controller';
import { CampaignPlannerService } from './campaign-planner.service';

@Module({
  imports: [AiRuntimeModule],
  controllers: [CampaignPlannerController],
  providers: [CampaignPlannerService],
  exports: [CampaignPlannerService],
})
export class CampaignPlannerModule {}
