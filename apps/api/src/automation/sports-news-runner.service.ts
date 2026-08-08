import { Injectable, Logger } from '@nestjs/common';
import { SportsNewsSettingsService } from './sports-news-settings.service';

export type SportsNewsRunKind = 'morning' | 'evening';

@Injectable()
export class SportsNewsRunnerService {
  private readonly logger = new Logger(SportsNewsRunnerService.name);
  private running = new Set<SportsNewsRunKind>();

  constructor(private readonly settingsService: SportsNewsSettingsService) {}

  async run(kind: SportsNewsRunKind, trigger: 'schedule' | 'manual' = 'schedule') {
    if (this.running.has(kind)) return { skipped: true, reason: 'already_running', kind };
    this.running.add(kind);
    try {
      const settings = await this.settingsService.get();
      if (!settings.enabled) return { skipped: true, reason: 'sports_news_disabled', kind };
      if (kind === 'morning' && !settings.morningEnabled) return { skipped: true, reason: 'morning_disabled', kind };
      if (kind === 'evening' && !settings.eveningEnabled) return { skipped: true, reason: 'evening_disabled', kind };

      const telegram = settings.telegramEnabled && (kind === 'morning' ? settings.morningTelegramEnabled : settings.eveningTelegramEnabled);
      const facebook = settings.facebookEnabled && (kind === 'morning' ? settings.morningFacebookEnabled : settings.eveningFacebookEnabled);
      if (!telegram && !facebook) return { skipped: true, reason: 'no_enabled_destination', kind };
      if (telegram && !settings.telegramChannelId) throw new Error('Telegram publishing is enabled but no Telegram channel is selected.');
      if (facebook && !settings.facebookChannelId) throw new Error('Facebook publishing is enabled but no Facebook page is selected.');

      // Generation/source retrieval will plug into this runner next. Do not publish placeholders.
      await this.settingsService.markRun(kind, 'READY');
      this.logger.log(`Sports news ${kind} runner ready (${trigger}). Telegram=${telegram}, Facebook=${facebook}`);
      return { skipped: false, kind, trigger, status: 'READY', destinations: { telegram, facebook } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sports news runner error';
      await this.settingsService.markRun(kind, 'FAILED', message).catch(() => undefined);
      this.logger.error(`Sports news ${kind} run failed: ${message}`);
      throw error;
    } finally {
      this.running.delete(kind);
    }
  }
}
