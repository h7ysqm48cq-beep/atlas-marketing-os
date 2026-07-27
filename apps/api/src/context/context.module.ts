import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ContextController } from './context.controller';
import { ContextService } from './context.service';

@Module({
  imports: [BrandsModule, MemoryModule, KnowledgeModule],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
