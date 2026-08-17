import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssetImageBackgroundJobService } from './asset-image-background-job.service';
import { AssetImageEditorService } from './asset-image-editor.service';
import { AssetImageService } from './asset-image.service';
import { BrandExistingAssetDto } from './dto/brand-existing-asset.dto';
import { CompositeExistingAssetDto } from './dto/composite-existing-asset.dto';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';
import { FocusEraseAssetDto } from './dto/focus-erase-asset.dto';

@Controller('asset-images')
export class AssetImageController {
  constructor(
    private readonly assetImageService: AssetImageService,
    private readonly backgroundJobs: AssetImageBackgroundJobService,
    private readonly imageEditor: AssetImageEditorService,
  ) {}

  @Post('generate')
  generate(@Body() dto: GenerateAssetImageDto) {
    return this.assetImageService.generateAndSave(dto);
  }

  @Post('brand-existing')
  brandExisting(@Body() dto: BrandExistingAssetDto) {
    return this.assetImageService.brandExistingAsset(dto);
  }

  @Post('focus-erase')
  focusErase(@Body() dto: FocusEraseAssetDto) {
    return this.assetImageService.focusEraseAsset(dto);
  }

  @Get('editor/latest')
  latestEditorImage() {
    return this.imageEditor.latestImage();
  }

  @Post('editor/composite')
  compositeExisting(@Body() dto: CompositeExistingAssetDto) {
    return this.imageEditor.compositeExistingAsset(dto);
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
