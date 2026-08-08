import { Module } from '@nestjs/common';
import { SportsNewsSourceService } from './sports-news-source.service';

@Module({
  providers: [SportsNewsSourceService],
  exports: [SportsNewsSourceService],
})
export class NewsModule {}
