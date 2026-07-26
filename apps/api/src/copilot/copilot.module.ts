import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { MarketingPlannerService } from './marketing-planner.service';

@Module({
  imports: [BrandsModule],
  controllers: [CopilotController],
  providers: [
    CopilotService,
    MarketingPlannerService,
    ConversationMemoryService,
  ],
})
export class CopilotModule {}
