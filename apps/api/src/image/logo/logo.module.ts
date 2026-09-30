import { Module } from '@nestjs/common';

import { LogoOverlayService } from './logo-overlay.service';
import { LogoLayoutService } from './logo-layout.service';
import { SafeAreaService } from './safe-area.service';


@Module({
  providers: [
    LogoOverlayService,
    LogoLayoutService,
    SafeAreaService,
  ],
  exports: [
    LogoOverlayService,
  ],
})
export class LogoModule {}
