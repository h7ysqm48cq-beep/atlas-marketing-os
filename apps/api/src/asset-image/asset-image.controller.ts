import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssetImageBackgroundJobService } from './asset-image-background-job.service';
import { AssetImageEditorService } from './asset-image-editor.service';
import { AssetImageService } from './asset-image.service';
import { BrandExistingAssetDto } from './dto/brand-existing-asset.dto';
import { CompositeExistingAssetDto } from './dto/composite-existing-asset.dto';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';
import { EraseExistingAssetDto } from './dto/erase-existing-asset.dto';
import { AiEditExistingAssetDto } from './dto/ai-edit-existing-asset.dto';
import { UpdateAssetBrandingDto } from './dto/update-asset-branding.dto';

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

  @Post(':id/branding')
  updateBranding(@Param('id') id: string, @Body() dto: UpdateAssetBrandingDto) {
    return this.assetImageService.updateBranding(id, dto);
  }

  @Get('editor/latest')
  latestEditorImage() {
    return this.imageEditor.latestImage();
  }

  @Post('editor/composite')
  compositeExisting(@Body() dto: CompositeExistingAssetDto) {
    return this.imageEditor.compositeExistingAsset(dto);
  }

  @Post('editor/erase')
  eraseExisting(@Body() dto: EraseExistingAssetDto) {
    return this.imageEditor.eraseExistingAsset(dto);
  }

  @Post('editor/ai-edit')
  aiEditExisting(@Body() dto: AiEditExistingAssetDto) {
    return this.imageEditor.aiEditExistingAsset(dto);
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
