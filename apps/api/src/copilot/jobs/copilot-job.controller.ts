import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';

import { CopilotJobService } from './copilot-job.service';

@Controller('copilot/chat')
export class CopilotJobController {

  constructor(
    private readonly jobs: CopilotJobService,
  ) {}

  @Post('jobs')
  create(
    @Body()
    body: {
      prompt: string;
      brandId?: string;
      conversationId?: string;
    },
  ) {
    return this.jobs.create(body);
  }


  @Get('jobs/:id')
  get(
    @Param('id') id: string,
  ) {
    return this.jobs.get(id);
  }
}
