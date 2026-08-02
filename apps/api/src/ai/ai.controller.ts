import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { TopicSuggestionsDto } from './dto/topic-suggestions.dto';
import { AiBackgroundJobService } from './ai-background-job.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly jobs: AiBackgroundJobService,
  ) {}
  @Post('generate') generate(@Body() dto: GenerateContentDto) { return this.aiService.generate(dto); }
  @Post('jobs')
  @HttpCode(202)
  createJob(@Body() dto: GenerateContentDto) {
    return this.jobs.enqueue(dto);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.jobs.get(id);
  }
  @Post('topic-suggestions')
  topicSuggestions(
    @Body() dto: TopicSuggestionsDto,
  ) {
    return this.aiService
      .suggestTopics(dto);
  }

  @Post('prompt-preview') previewPrompt(@Body() dto: GenerateContentDto) { return this.aiService.previewPrompt(dto); }
}
