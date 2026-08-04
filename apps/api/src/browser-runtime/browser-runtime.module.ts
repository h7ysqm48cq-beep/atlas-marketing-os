import {
  Module,
} from '@nestjs/common';
import {
  SocialTokenCryptoService,
} from '../common/social-token-crypto.service';
import {
  BrowserAccountController,
} from './controllers/browser-account.controller';
import {
  BrowserAccountService,
} from './services/browser-account.service';

@Module({
  controllers: [
    BrowserAccountController,
  ],
  providers: [
    BrowserAccountService,
    SocialTokenCryptoService,
  ],
  exports: [
    BrowserAccountService,
  ],
})
export class BrowserRuntimeModule {}
