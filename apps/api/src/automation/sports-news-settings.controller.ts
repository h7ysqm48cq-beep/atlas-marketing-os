import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { SportsNewsRunHistoryService } from '../news/sports-news-run-history.service';
import { SportsNewsRunnerService } from './sports-news-runner.service';
import { SportsNewsSettingsService, UpdateSportsNewsSettingsInput } from './sports-news-settings.service';

@Controller('sports-news')
export class SportsNewsSettingsController {
  constructor(
    private readonly settings: SportsNewsSettingsService,
    private readonly runner: SportsNewsRunnerService,
    private readonly runHistory: SportsNewsRunHistoryService,
  ) {}
  @Get('settings') getSettings() { return this.settings.get(); }
  @Patch('settings') updateSettings(@Body() body: UpdateSportsNewsSettingsInput) { return this.settings.update(body); }
  @Get('channels') channels() { return this.settings.channels(); }
  @Get('runs') runs(@Query('limit') limit?: string) { const parsed = Number(limit ?? 10); return this.runHistory.recent(Number.isFinite(parsed) ? parsed : 10); }
  @Post('run/morning') runMorning() { return this.runner.run('morning', 'manual'); }
  @Post('run/evening') runEvening() { return this.runner.run('evening', 'manual'); }
}
