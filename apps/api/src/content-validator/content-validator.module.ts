import { Module } from '@nestjs/common';
import { ContentValidatorController } from './content-validator.controller';
import { ContentValidatorService } from './content-validator.service';

@Module({
  controllers: [
    ContentValidatorController,
  ],
  providers: [
    ContentValidatorService,
  ],
  exports: [
    ContentValidatorService,
  ],
})
export class ContentValidatorModule {}
