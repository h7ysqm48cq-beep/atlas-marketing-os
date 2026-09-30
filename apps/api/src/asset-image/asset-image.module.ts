import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { BrandsModule } from '../brands/brands.module';
import {
  LogoLayoutService,
  LogoOverlayService,
  SafeAreaService,
} from '../image/logo';
import { StorageModule } from '../storage/storage.module';
import { AssetImageBackgroundJobService } from './asset-image-background-job.service';
import { AssetImageController } from './asset-image.controller';
import { AssetImageEditorService } from './asset-image-editor.service';
import { ImageProcessingModule } from '../image-processing/image-processing.module';
import { AssetImageService } from './asset-image.service';

import { ImageSettingsModule } from '../image-settings/image-settings.module';
import { BrandRendererModule } from '../brand-renderer/brand-renderer.module';
@Module({
  imports: [
    BrandRendererModule,
    ImageSettingsModule,
    ImageProcessingModule,AiRuntimeModule, BrandsModule, StorageModule],
  controllers: [AssetImageController],
  providers: [
    AssetImageService,
    AssetImageEditorService,
    AssetImageBackgroundJobService,
    LogoOverlayService,
    LogoLayoutService,
    SafeAreaService,
  ],
  exports: [
    AssetImageService,
    AssetImageEditorService,
    AssetImageBackgroundJobService,
    LogoOverlayService,
    LogoLayoutService,
    SafeAreaService,
  ],
})
export class AssetImageModule {}
