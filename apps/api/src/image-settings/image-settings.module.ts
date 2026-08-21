import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ImageSettingsController } from './image-settings.controller';
import { ImageSettingsService } from './image-settings.service';

@Module({
  controllers: [ImageSettingsController],
  providers: [
    ImageSettingsService,
  ],
  exports: [
    ImageSettingsService,
  ],
})
export class ImageSettingsModule {}
