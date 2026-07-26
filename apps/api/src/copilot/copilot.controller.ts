import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotService } from './copilot.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';
import { MarketingPlannerService } from './marketing-planner.service';

@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly service: CopilotService,
    private readonly marketingPlanner: MarketingPlannerService,
    private readonly conversations: ConversationMemoryService,
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

  @Post('conversations')
  createConversation(
    @Body()
    body: {
      campaignId?: string;
      mode?: string;
      firstMessage?: string;
    },
  ) {
    return this.conversations.create(body);
  }

  @Get('conversations')
  listConversations() {
    return this.conversations.list();
  }

  @Get('conversations/:id')
  getConversation(
    @Param('id') id: string,
  ) {
    return this.conversations.get(id);
  }

  @Patch('conversations/:id')
  renameConversation(
    @Param('id') id: string,
    @Body() body: { title?: string },
  ) {
    return this.conversations.rename(
      id,
      body.title || '',
    );
  }

  @Delete('conversations/:id')
  deleteConversation(
    @Param('id') id: string,
  ) {
    return this.conversations.delete(id);
  }
}
