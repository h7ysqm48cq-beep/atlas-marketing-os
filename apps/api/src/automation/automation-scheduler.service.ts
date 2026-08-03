import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';
import { PublisherService } from './publisher.service';
import { SportsNewsAutomationService } from './sports-news-automation.service';

@Injectable()
export class AutomationSchedulerService {
  private readonly logger =
    new Logger(
      AutomationSchedulerService.name,
    );

  constructor(
    private readonly publisher:
      PublisherService,
    private readonly sportsNews:
      SportsNewsAutomationService,
  ) {}

  @Cron(
    CronExpression.EVERY_MINUTE,
    {
      name: 'atlas-publisher',
      timeZone: 'Asia/Kuala_Lumpur',
      waitForCompletion: true,
    },
  )
  async publishDuePosts() {
    const startedAt = Date.now();

    try {
      const result =
        await this.publisher.run();

      if (result.found > 0) {
        this.logger.log(
          [
            'Publisher cycle completed.',
            `Found: ${result.found}.`,
            `Published: ${result.published}.`,
            `Duration: ${
              Date.now() - startedAt
            }ms.`,
          ].join(' '),
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown scheduler error';

      this.logger.error(
        `Publisher cycle failed: ${message}`,
        error instanceof Error
          ? error.stack
          : undefined,
      );
    }
  }

  @Cron('0 9 * * *', {
    name: 'atlas-sports-news-morning',
    timeZone: 'Asia/Kuala_Lumpur',
    waitForCompletion: true,
  })
  publishMorningSportsNews() {
    return this.sportsNews.run('09:00');
  }

  @Cron('0 20 * * *', {
    name: 'atlas-sports-news-evening',
    timeZone: 'Asia/Kuala_Lumpur',
    waitForCompletion: true,
  })
  publishEveningSportsNews() {
    return this.sportsNews.run('20:00');
  }
}
