import { Module } from '@nestjs/common';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageService } from './ai-usage.service';

@Module({
  controllers: [
    AiUsageController,
  ],
  providers: [
    AiUsageService,
  ],
  exports: [
    AiUsageService,
  ],
})
export class AiUsageModule {}
