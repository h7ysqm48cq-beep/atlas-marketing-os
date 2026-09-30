import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SportsNewsSettingsService } from './sports-news-settings.service';
import type { UpdateSportsNewsSettingsInput } from './sports-news-settings.service';

@Controller('sports-news')
export class SportsNewsSettingsController {
  constructor(private readonly settings: SportsNewsSettingsService) {}

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  updateSettings(@Body() body: UpdateSportsNewsSettingsInput) {
    return this.settings.update(body);
  }

  @Get('channels')
  channels() {
    return this.settings.channels();
  }
}
