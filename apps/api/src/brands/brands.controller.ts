import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  list() {
    return this.brandsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.brandsService.get(id);
  }

  @Post()
  create(@Body() dto: CreateBrandDto) {
    return this.brandsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brandsService.update(id, dto);
  }
}
