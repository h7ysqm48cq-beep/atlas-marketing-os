import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CopilotImageService } from './copilot-image.service';
import { AssetImageBackgroundJobService } from '../../asset-image/asset-image-background-job.service';

@Controller('copilot')
export class CopilotImageController {
  constructor(
    private readonly service: CopilotImageService,
    private readonly backgroundJobs: AssetImageBackgroundJobService,
  ) {}

  @Post('image')
  generate(
    @Body()
    body: {
      content: string;
      platform?: string;
      conversationId?: string;
      messageIndex?: number;
    },
  ) {
    return this.service.generate(body);
  }

  @Get('image/jobs')
  getActiveImageJobs() {
    return this.backgroundJobs.getActiveJobs();
  }

  @Get('image/:id')
  getImageJob(
    @Param('id')
    id: string,
  ) {
    return this.backgroundJobs.getJob(id);
  }
}
