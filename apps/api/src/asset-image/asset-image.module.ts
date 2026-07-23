import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { AssetImageController } from './asset-image.controller';
import { AssetImageService } from './asset-image.service';

@Module({
  imports: [BrandsModule],
  controllers: [AssetImageController],
  providers: [AssetImageService],
  exports: [AssetImageService],
})
export class AssetImageModule {}
