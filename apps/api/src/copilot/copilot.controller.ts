import { Body, Controller, Post } from '@nestjs/common';
import { CopilotService } from './copilot.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';

@Controller('copilot')
export class CopilotController {
  constructor(private readonly service: CopilotService) {}

  @Post('chat')
  chat(@Body() dto: ChatCopilotDto) {
    return this.service.chat(dto);
  }
}
