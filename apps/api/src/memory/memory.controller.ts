import { Controller, Get, Post } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('summary')
  summary() {
    return this.memoryService.summary();
  }

  @Post('rebuild')
  rebuild() {
    // Memory is dynamically calculated in Sprint 15.1A.
    return this.memoryService.summary();
  }
}
