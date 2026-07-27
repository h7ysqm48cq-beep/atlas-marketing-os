import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { ImagePromptEngineService } from './image-prompt-engine.service';
import type {
  BuildImagePromptInput,
} from './image-prompt-engine.types';

@Controller('image-prompt-engine')
export class ImagePromptEngineController {
  constructor(
    private readonly imagePromptEngineService:
      ImagePromptEngineService,
  ) {}

  @Get()
  status() {
    return this.imagePromptEngineService.status();
  }

  @Post('build')
  build(
    @Body() input: BuildImagePromptInput,
  ) {
    return this.imagePromptEngineService.build(
      input,
    );
  }
}
