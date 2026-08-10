import { Module } from '@nestjs/common';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { BrandOverlayService } from './brand/brand-overlay.service';
import { BrandsModule } from '../brands/brands.module';

@Module({
  imports: [BrandsModule],
  controllers: [ImageController],
  providers: [ImageService, BrandOverlayService],
  exports: [ImageService, BrandOverlayService],
})
export class ImageModule {}
