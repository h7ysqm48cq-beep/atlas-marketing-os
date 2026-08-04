import {
  Module,
} from '@nestjs/common';
import {
  AutomationModule,
} from '../automation/automation.module';
import {
  SocialTokenCryptoService,
} from '../common/social-token-crypto.service';
import {
  BrowserAccountController,
} from './controllers/browser-account.controller';
import {
  BrowserAccountService,
} from './services/browser-account.service';
import {
  BrowserSessionService,
} from './services/browser-session.service';
import {
  BrowserTimelineService,
} from './services/browser-timeline.service';
import {
  BrowserAutomationPolicyService,
} from './services/browser-automation-policy.service';
import {
  BrowserOnboardingService,
} from './services/browser-onboarding.service';
import {
  BrowserRuntimeEventBus,
} from './events/browser-runtime-event-bus.service';
import {
  BrowserRuntimeAutomationListener,
} from './events/browser-runtime-automation.listener';

@Module({
  imports: [
    AutomationModule,
  ],
  controllers: [
    BrowserAccountController,
  ],
  providers: [
    BrowserAccountService,
    BrowserSessionService,
    BrowserTimelineService,
    BrowserAutomationPolicyService,
    BrowserOnboardingService,
    BrowserRuntimeEventBus,
    BrowserRuntimeAutomationListener,
    SocialTokenCryptoService,
  ],
  exports: [
    BrowserAccountService,
    BrowserRuntimeEventBus,
  ],
})
export class BrowserRuntimeModule {}
