import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';

@Controller('ai-usage')
export class AiUsageController {
  constructor(
    private readonly aiUsageService:
      AiUsageService,
  ) {}

  @Get('summary')
  summary(
    @Query('days') days?: string,
  ) {
    return this.aiUsageService.summary(
      Number(days) || 30,
    );
  }

  @Get('recent')
  recent(
    @Query('limit') limit?: string,
  ) {
    return this.aiUsageService.recent(
      Number(limit) || 20,
    );
  }

  @Get('trend')
  trend(
    @Query('days') days?: string,
  ) {
    return this.aiUsageService.trend(
      Number(days) || 30,
    );
  }
}
