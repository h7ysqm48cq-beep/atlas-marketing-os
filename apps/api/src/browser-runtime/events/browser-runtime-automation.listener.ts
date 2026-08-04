import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  BrowserOnboardingService,
} from '../services/browser-onboarding.service';
import {
  BrowserRuntimeEventBus,
} from './browser-runtime-event-bus.service';

@Injectable()
export class BrowserRuntimeAutomationListener
implements
  OnModuleInit,
  OnModuleDestroy {
  private unsubscribe:
    (() => void) | null =
    null;

  constructor(
    private readonly eventBus:
      BrowserRuntimeEventBus,
    private readonly onboarding:
      BrowserOnboardingService,
  ) {}

  onModuleInit() {
    this.unsubscribe =
      this.eventBus.subscribe(
        'LOGIN_VERIFIED',
        async (event) => {
          await this.onboarding.run(
            event.accountId,
            {
              verifyLogin:
                false,
            },
          );
        },
      );
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }
}
