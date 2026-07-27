import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { PromptsService } from './prompts.service';

@Controller('prompts')
export class PromptsController {
  constructor(
    private readonly prompts: PromptsService,
  ) {}

  @Post()
  create(@Body() dto: CreatePromptDto) {
    return this.prompts.create(dto);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('favorite') favorite?: string,
  ) {
    return this.prompts.findAll({
      search,
      category,
      favorite,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prompts.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePromptDto,
  ) {
    return this.prompts.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prompts.remove(id);
  }

  @Post(':id/use')
  recordUsage(@Param('id') id: string) {
    return this.prompts.recordUsage(id);
  }
}
