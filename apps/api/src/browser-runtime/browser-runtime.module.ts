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
    SocialTokenCryptoService,
  ],
  exports: [
    BrowserAccountService,
  ],
})
export class BrowserRuntimeModule {}
