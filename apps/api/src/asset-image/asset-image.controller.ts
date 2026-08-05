import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssetImageBackgroundJobService } from './asset-image-background-job.service';
import { AssetImageService } from './asset-image.service';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';

@Controller('asset-images')
export class AssetImageController {
  constructor(
    private readonly assetImageService: AssetImageService,
    private readonly backgroundJobs: AssetImageBackgroundJobService,
  ) {}

  /*
   * Existing synchronous endpoint retained for internal services
   * and backwards compatibility.
   */
  @Post('generate')
  generate(@Body() dto: GenerateAssetImageDto) {
    return this.assetImageService.generateAndSave(dto);
  }

  /*
   * Browser-facing background endpoint. It returns immediately
   * with a durable database job ID.
   */
  @Post('jobs')
  createJob(@Body() dto: GenerateAssetImageDto) {
    return this.backgroundJobs.enqueue(dto);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.backgroundJobs.getJob(id);
  }
}
