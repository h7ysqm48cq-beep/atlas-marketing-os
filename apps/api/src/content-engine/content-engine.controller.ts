import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';

import { ContentEngineService } from './content-engine.service';
import type { GenerateContentInput } from './content-engine.types';

@Controller('content-engine')
export class ContentEngineController {

  constructor(
    private readonly contentEngineService:
      ContentEngineService,
  ) {}

  @Get()
  status() {
    return this.contentEngineService.status();
  }

  @Post('generate')
  async generate(
    @Body()
    input: GenerateContentInput,
  ) {
    return this.contentEngineService.generate(
      input,
    );
  }
}
