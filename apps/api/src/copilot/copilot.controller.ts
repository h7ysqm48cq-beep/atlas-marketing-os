import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotService } from './copilot.service';
import { CopilotAttachmentService } from './copilot-attachment.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';
import { MarketingPlannerService } from './marketing-planner.service';

@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly service: CopilotService,
    private readonly marketingPlanner: MarketingPlannerService,
    private readonly conversations: ConversationMemoryService,
    private readonly attachments: CopilotAttachmentService,
  ) {}

  @Post('attachments/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  uploadImageAttachment(
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.attachments.uploadImage(file);
  }

  @Post('chat')
  chat(@Body() dto: ChatCopilotDto) {
    return this.service.chat(dto);
  }

  @Post('marketing-plan')
  async marketingPlan(@Body() dto: CreateMarketingPlanDto) {
    const conversation = await this.conversations.ensureConversation({
      conversationId: dto.conversationId,
      campaignId: dto.campaignId,
      mode: 'marketing-plan',
      firstMessage: dto.prompt,
    });

    await this.conversations.appendUserMessage(conversation.id, dto.prompt);

    const plan = await this.marketingPlanner.generate(dto);

    const summary = [
      `Marketing Plan: ${plan.campaignName}`,
      `Objective: ${plan.objective}`,
      `Audience: ${plan.audience}`,
      `Hook: ${plan.hook}`,
      `Key Message: ${plan.keyMessage}`,
    ].join('\n');

    await this.conversations.appendAssistantMessage(conversation.id, summary, {
      mode: 'marketing-plan',
      campaignName: plan.campaignName,
      marketingPlan: plan,
    });

    return {
      ...plan,
      conversation: {
        id: conversation.id,
        title: conversation.title,
      },
    };
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
  getConversation(@Param('id') id: string) {
    return this.conversations.get(id);
  }

  @Patch('conversations/:id')
  renameConversation(
    @Param('id') id: string,
    @Body() body: { title?: string },
  ) {
    return this.conversations.rename(id, body.title || '');
  }

  @Delete('conversations/:id')
  deleteConversation(@Param('id') id: string) {
    return this.conversations.delete(id);
  }
}
