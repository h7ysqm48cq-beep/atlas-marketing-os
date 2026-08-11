import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';
import { LeadsController } from './leads/leads.controller';
import { LeadScoringService } from './leads/lead-scoring.service';
import { LeadsService } from './leads/leads.service';

@Module({
  imports: [BrandsModule],
  controllers: [GrowthController, LeadsController],
  providers: [GrowthService, LeadsService, LeadScoringService],
  exports: [GrowthService, LeadsService],
})
export class GrowthModule {}
