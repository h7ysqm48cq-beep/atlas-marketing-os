import { Body, Controller, Post } from '@nestjs/common';
import { AssetImageService } from './asset-image.service';
import { GenerateAssetImageDto } from './dto/generate-asset-image.dto';

@Controller('asset-images')
export class AssetImageController {
  constructor(
    private readonly assetImageService: AssetImageService,
  ) {}

  @Post('generate')
  generate(@Body() dto: GenerateAssetImageDto) {
    return this.assetImageService.generateAndSave(dto);
  }
}
