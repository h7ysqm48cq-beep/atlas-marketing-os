import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { MemoryModule } from '../memory/memory.module';
import { HistoryModule } from '../history/history.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [BrandsModule, MemoryModule, KnowledgeModule, HistoryModule, AiUsageModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
