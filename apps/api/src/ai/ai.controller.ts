import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { TopicSuggestionsDto } from './dto/topic-suggestions.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}
  @Post('generate') generate(@Body() dto: GenerateContentDto) { return this.aiService.generate(dto); }
  @Post('topic-suggestions')
  topicSuggestions(
    @Body() dto: TopicSuggestionsDto,
  ) {
    return this.aiService
      .suggestTopics(dto);
  }

  @Post('prompt-preview') previewPrompt(@Body() dto: GenerateContentDto) { return this.aiService.previewPrompt(dto); }
}
