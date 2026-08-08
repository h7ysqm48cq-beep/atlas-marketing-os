import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { ImageModule } from '../image/image.module';
import { SportsNewsGeneratorService } from './sports-news-generator.service';
import { SportsNewsImageService } from './sports-news-image.service';
import { SportsNewsSourceService } from './sports-news-source.service';

@Module({
  imports: [AiProviderModule, ImageModule],
  providers: [SportsNewsSourceService, SportsNewsGeneratorService, SportsNewsImageService],
  exports: [SportsNewsSourceService, SportsNewsGeneratorService, SportsNewsImageService],
})
export class NewsModule {}
