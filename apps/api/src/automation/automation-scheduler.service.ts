import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PublisherService } from './publisher.service';
import { SportsNewsRunnerService, SportsNewsRunKind } from './sports-news-runner.service';
import { SportsNewsSettingsService } from './sports-news-settings.service';

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private lastSportsNewsSlot = new Map<SportsNewsRunKind, string>();

  constructor(
    private readonly publisher: PublisherService,
    private readonly sportsNewsRunner: SportsNewsRunnerService,
    private readonly sportsNewsSettings: SportsNewsSettingsService,
  ) {}

  @Cron('*/10 * * * *', { name: 'atlas-publisher', timeZone: 'Asia/Kuala_Lumpur', waitForCompletion: true })
  async publishDuePosts() {
    const startedAt = Date.now();
    try {
      const result = await this.publisher.run();
      if (result.found > 0) this.logger.log(`Publisher cycle completed. Found: ${result.found}. Published: ${result.published}. Duration: ${Date.now()-startedAt}ms.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown scheduler error';
      this.logger.error(`Publisher cycle failed: ${message}`, error instanceof Error ? error.stack : undefined);
    }
  }

  @Cron('* * * * *', { name: 'atlas-sports-news', timeZone: 'Asia/Kuala_Lumpur', waitForCompletion: true })
  async runSportsNewsSchedule() {
    try {
      const settings = await this.sportsNewsSettings.get();
      if (!settings.enabled) return;
      const local = this.localParts(new Date(), settings.timezone);
      await this.runIfDue('morning', settings.morningEnabled, settings.morningTime, local);
      await this.runIfDue('evening', settings.eveningEnabled, settings.eveningTime, local);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sports news scheduler error';
      this.logger.error(`Sports news scheduler failed: ${message}`);
    }
  }

  private async runIfDue(kind: SportsNewsRunKind, enabled: boolean, configuredTime: string, local: { date: string; time: string }) {
    if (!enabled || configuredTime !== local.time) return;
    const slot = `${local.date}:${configuredTime}`;
    if (this.lastSportsNewsSlot.get(kind) === slot) return;
    this.lastSportsNewsSlot.set(kind, slot);
    try { await this.sportsNewsRunner.run(kind, 'schedule'); }
    catch { this.lastSportsNewsSlot.delete(kind); }
  }

  private localParts(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
  }
}
