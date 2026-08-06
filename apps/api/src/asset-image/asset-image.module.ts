import { Module } from '@nestjs/common';
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
import { AssetImageService } from './asset-image.service';

@Module({
  imports: [BrandsModule, StorageModule],
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
