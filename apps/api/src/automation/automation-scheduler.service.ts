import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Cron,
} from '@nestjs/schedule';
import { PublisherService } from './publisher.service';

@Injectable()
export class AutomationSchedulerService {
  private readonly logger =
    new Logger(
      AutomationSchedulerService.name,
    );

  constructor(
    private readonly publisher:
      PublisherService,
  ) {}

  @Cron(
    '*/10 * * * *',
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
}
