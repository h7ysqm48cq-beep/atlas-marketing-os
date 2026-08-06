import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import {
  AnalyzeEngineeringRequestDto,
} from './dto/analyze-engineering-request.dto';
import {
  EngineeringService,
} from './engineering.service';

@Controller('engineering')
export class EngineeringController {
  constructor(
    private readonly engineeringService:
      EngineeringService,
  ) {}

  @Post('analyze')
  analyze(
    @Body()
    input: AnalyzeEngineeringRequestDto,
  ) {
    return this.engineeringService
      .analyze(input);
  }
}
