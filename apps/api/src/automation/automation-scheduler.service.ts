import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';
import { PublisherService } from './publisher.service';

@Injectable()
export class AutomationSchedulerService implements OnModuleInit {
  private readonly logger =
    new Logger(
      AutomationSchedulerService.name,
    );

  private readonly enabled =
    process.env.AUTOMATION_SCHEDULER_ENABLED !==
    'false';

  constructor(
    private readonly publisher:
      PublisherService,
  ) {}

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn(
        'Automation publisher scheduler is disabled by AUTOMATION_SCHEDULER_ENABLED=false.',
      );
    }
  }

  @Cron(
    CronExpression.EVERY_MINUTE,
    {
      name: 'atlas-publisher',
      timeZone: 'Asia/Kuala_Lumpur',
      waitForCompletion: true,
    },
  )
  async publishDuePosts() {
    if (!this.enabled) {
      return;
    }

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
}
