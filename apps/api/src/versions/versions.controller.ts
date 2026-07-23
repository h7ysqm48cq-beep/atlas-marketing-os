import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateVersionDto } from './dto/create-version.dto';
import { VersionsService } from './versions.service';

@Controller('versions')
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Post()
  create(@Body() dto: CreateVersionDto) {
    return this.versionsService.create(dto);
  }

  @Get()
  list(
    @Query('historyId') historyId: string,
    @Query('platform') platform?: string,
  ) {
    return this.versionsService.list(historyId, platform);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.versionsService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.versionsService.remove(id);
  }
}
