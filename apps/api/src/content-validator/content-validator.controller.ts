import {
  Controller,
  Get,
} from '@nestjs/common';
import { ContentValidatorService } from './content-validator.service';

@Controller('content-validator')
export class ContentValidatorController {
  constructor(
    private readonly contentValidatorService:
      ContentValidatorService,
  ) {}

  @Get()
  status() {
    return this.contentValidatorService.status();
  }
}
