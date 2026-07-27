import { Module } from '@nestjs/common';
import { ImagePromptEngineController } from './image-prompt-engine.controller';
import { ImagePromptEngineService } from './image-prompt-engine.service';

@Module({
  controllers: [
    ImagePromptEngineController,
  ],
  providers: [
    ImagePromptEngineService,
  ],
  exports: [
    ImagePromptEngineService,
  ],
})
export class ImagePromptEngineModule {}
