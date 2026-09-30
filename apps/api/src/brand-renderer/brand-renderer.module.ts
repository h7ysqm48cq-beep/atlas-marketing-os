import { Module } from '@nestjs/common';

import { LogoModule } from '../image/logo/logo.module';

import { BrandRendererService } from './brand-renderer.service';
import { FooterRendererService } from './footer/footer-renderer.service';
import { CollisionGuardService } from './collision/collision-guard.service';
import { BrandBrainRulesService } from './rules/brand-brain-rules.service';
import { BrandSettingResolverService } from './resolver/brand-setting-resolver.service';

@Module({
  imports: [
    LogoModule,
  ],
  providers: [
    BrandRendererService,
    FooterRendererService,
    CollisionGuardService,
    BrandBrainRulesService,
    BrandSettingResolverService,
  ],
  exports: [
    BrandRendererService,
    BrandSettingResolverService,
  ],
})
export class BrandRendererModule {}
