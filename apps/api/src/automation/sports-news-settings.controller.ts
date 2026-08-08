import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { SportsNewsRunnerService } from './sports-news-runner.service';
import { SportsNewsSettingsService, UpdateSportsNewsSettingsInput } from './sports-news-settings.service';

@Controller('sports-news')
export class SportsNewsSettingsController {
  constructor(
    private readonly settings: SportsNewsSettingsService,
    private readonly runner: SportsNewsRunnerService,
  ) {}

  @Get('settings')
  getSettings() { return this.settings.get(); }

  @Patch('settings')
  updateSettings(@Body() body: UpdateSportsNewsSettingsInput) { return this.settings.update(body); }

  @Get('channels')
  channels() { return this.settings.channels(); }

  @Post('run/morning')
  runMorning() { return this.runner.run('morning', 'manual'); }

  @Post('run/evening')
  runEvening() { return this.runner.run('evening', 'manual'); }
}
