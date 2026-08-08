import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { SportsNewsGeneratorService } from './sports-news-generator.service';
import { SportsNewsSourceService } from './sports-news-source.service';

@Module({
  imports: [AiProviderModule],
  providers: [SportsNewsSourceService, SportsNewsGeneratorService],
  exports: [SportsNewsSourceService, SportsNewsGeneratorService],
})
export class NewsModule {}
