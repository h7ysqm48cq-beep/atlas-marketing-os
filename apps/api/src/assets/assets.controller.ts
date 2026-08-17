import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File) {
    return this.assetsService.upload(file);
  }

  @Post()
  create(@Body() dto: CreateAssetDto) {
    return this.assetsService.create(dto);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('campaignId') campaignId?: string,
    @Query('favorite') favorite?: string,
    @Query('tag') tag?: string,
    @Query('collection') collection?: string,
    @Query('platform') platform?: string,
    @Query('provider') provider?: string,
    @Query('generationModel') generationModel?: string,
    @Query('storageProvider') storageProvider?: string,
    @Query('sort') sort?: string,
  ) {
    return this.assetsService.findAll({
      search,
      type,
      campaignId,
      favorite,
      tag,
      collection,
      platform,
      provider,
      generationModel,
      storageProvider,
      sort,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assetsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assetsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.assetsService.remove(id);
  }
}
