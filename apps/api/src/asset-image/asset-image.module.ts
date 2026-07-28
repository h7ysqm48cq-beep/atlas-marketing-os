import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { StorageModule } from '../storage/storage.module';
import { AssetImageController } from './asset-image.controller';
import { AssetImageService } from './asset-image.service';

@Module({
  imports: [BrandsModule, StorageModule],
  controllers: [AssetImageController],
  providers: [AssetImageService],
  exports: [AssetImageService],
})
export class AssetImageModule {}
