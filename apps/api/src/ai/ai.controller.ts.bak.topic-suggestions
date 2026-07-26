import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerateContentDto } from './dto/generate-content.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}
  @Post('generate') generate(@Body() dto: GenerateContentDto) { return this.aiService.generate(dto); }
  @Post('prompt-preview') previewPrompt(@Body() dto: GenerateContentDto) { return this.aiService.previewPrompt(dto); }
}
