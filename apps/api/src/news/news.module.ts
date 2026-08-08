import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { ImageModule } from '../image/image.module';
import { SportsNewsGeneratorService } from './sports-news-generator.service';
import { SportsNewsImageService } from './sports-news-image.service';
import { SportsNewsPublishService } from './sports-news-publish.service';
import { SportsNewsSourceService } from './sports-news-source.service';

@Module({
  imports: [AiProviderModule, ImageModule],
  providers: [SportsNewsSourceService, SportsNewsGeneratorService, SportsNewsImageService, SportsNewsPublishService],
  exports: [SportsNewsSourceService, SportsNewsGeneratorService, SportsNewsImageService, SportsNewsPublishService],
})
export class NewsModule {}
