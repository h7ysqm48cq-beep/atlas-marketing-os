import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { MemoryController } from './memory.controller';
import { MemoryFactsService } from './memory-facts.service';
import { MemoryService } from './memory.service';

@Module({
  imports: [BrandsModule],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    MemoryFactsService,
  ],
  exports: [
    MemoryService,
    MemoryFactsService,
  ],
})
export class MemoryModule {}
