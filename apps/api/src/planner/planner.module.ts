import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { BrandsModule } from '../brands/brands.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

@Module({
  imports: [ContextModule, BrandsModule, MemoryModule, KnowledgeModule],
  controllers: [PlannerController],
  providers: [PlannerService],
  exports: [PlannerService],
})
export class PlannerModule {}
