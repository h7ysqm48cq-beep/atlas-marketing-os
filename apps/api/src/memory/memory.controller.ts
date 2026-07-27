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
import { CreateMemoryFactDto } from './dto/create-memory-fact.dto';
import { UpdateMemoryFactDto } from './dto/update-memory-fact.dto';
import { MemoryFactsService } from './memory-facts.service';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly memoryFacts: MemoryFactsService,
  ) {}

  @Get('summary')
  summary() {
    return this.memoryService.summary();
  }

  @Post('rebuild')
  rebuild() {
    return this.memoryService.summary();
  }

  @Post('facts')
  createFact(
    @Body() dto: CreateMemoryFactDto,
  ) {
    return this.memoryFacts.create(dto);
  }

  @Get('facts')
  listFacts(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.memoryFacts.findAll({
      search,
      status,
      type,
    });
  }

  @Get('facts/:id')
  getFact(@Param('id') id: string) {
    return this.memoryFacts.findOne(id);
  }

  @Patch('facts/:id')
  updateFact(
    @Param('id') id: string,
    @Body() dto: UpdateMemoryFactDto,
  ) {
    return this.memoryFacts.update(id, dto);
  }

  @Post('facts/:id/confirm')
  confirmFact(@Param('id') id: string) {
    return this.memoryFacts.confirm(id);
  }

  @Post('facts/:id/reject')
  rejectFact(@Param('id') id: string) {
    return this.memoryFacts.reject(id);
  }

  @Delete('facts/:id')
  deleteFact(@Param('id') id: string) {
    return this.memoryFacts.remove(id);
  }
}
