import { Global, Module } from '@nestjs/common';
import { DateTimeService } from './datetime.service';
import { SocialTokenCryptoService } from './social-token-crypto.service';

@Global()
@Module({
  providers: [
    DateTimeService,
    SocialTokenCryptoService,
  ],
  exports: [
    DateTimeService,
    SocialTokenCryptoService,
  ],
})
export class CommonModule {}
