import { Module } from '@nestjs/common';
import { CampaignPlannerController } from './campaign-planner.controller';
import { CampaignPlannerService } from './campaign-planner.service';

@Module({
  controllers: [CampaignPlannerController],
  providers: [CampaignPlannerService],
  exports: [CampaignPlannerService],
})
export class CampaignPlannerModule {}
