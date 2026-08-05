import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssetImageBackgroundJobService } from './asset-image-background-job.service';
import { AssetImageService } from './asset-image.service';
import { BrandExistingAssetDto } from './dto/brand-existing-asset.dto';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';

@Controller('asset-images')
export class AssetImageController {
  constructor(
    private readonly assetImageService: AssetImageService,
    private readonly backgroundJobs: AssetImageBackgroundJobService,
  ) {}

  @Post('generate')
  generate(@Body() dto: GenerateAssetImageDto) {
    return this.assetImageService.generateAndSave(dto);
  }

  @Post('brand-existing')
  brandExisting(@Body() dto: BrandExistingAssetDto) {
    return this.assetImageService.brandExistingAsset(dto);
  }

  @Post('jobs')
  createJob(@Body() dto: GenerateAssetImageDto) {
    return this.backgroundJobs.enqueue(dto);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.backgroundJobs.getJob(id);
  }
}
