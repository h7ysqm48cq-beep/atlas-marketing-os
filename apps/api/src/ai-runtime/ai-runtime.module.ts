import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AiRuntimeSettingsController } from './ai-runtime-settings.controller';
import { AiRuntimeSettingsService } from './ai-runtime-settings.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    AiRuntimeSettingsController,
  ],
  providers: [
    AiRuntimeSettingsService,
  ],
  exports: [
    AiRuntimeSettingsService,
  ],
})
export class AiRuntimeModule {}
