import { Body, Controller, Post } from '@nestjs/common';
import { CopilotService } from './copilot.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';
import { MarketingPlannerService } from './marketing-planner.service';

@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly service: CopilotService,
    private readonly marketingPlanner: MarketingPlannerService,
  ) {}

  @Post('chat')
  chat(@Body() dto: ChatCopilotDto) {
    return this.service.chat(dto);
  }

  @Post('marketing-plan')
  marketingPlan(
    @Body() dto: CreateMarketingPlanDto,
  ) {
    return this.marketingPlanner.generate(dto);
  }
}
