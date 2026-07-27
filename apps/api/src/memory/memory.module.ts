import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { MemoryController } from './memory.controller';
import { MemoryFactsService } from './memory-facts.service';
import { MemoryFactExtractorService } from './memory-fact-extractor.service';
import { MemoryService } from './memory.service';

@Module({
  imports: [BrandsModule],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    MemoryFactsService,
    MemoryFactExtractorService,
  ],
  exports: [
    MemoryService,
    MemoryFactsService,
    MemoryFactExtractorService,
  ],
})
export class MemoryModule {}
