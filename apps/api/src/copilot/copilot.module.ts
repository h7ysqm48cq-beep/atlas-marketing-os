import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { MarketingPlannerService } from './marketing-planner.service';

@Module({
  imports: [BrandsModule],
  controllers: [CopilotController],
  providers: [CopilotService, MarketingPlannerService],
})
export class CopilotModule {}