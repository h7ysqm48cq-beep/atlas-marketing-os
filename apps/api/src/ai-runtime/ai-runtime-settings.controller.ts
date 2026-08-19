import {
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import {
  AiRuntimeSettings,
  AiRuntimeSettingsService,
} from './ai-runtime-settings.service';

@Controller('ai-runtime')
export class AiRuntimeSettingsController {
  constructor(
    private readonly settings:
      AiRuntimeSettingsService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  update(
    @Body()
    body: Partial<AiRuntimeSettings>,
  ) {
    return this.settings.update(body);
  }
}
