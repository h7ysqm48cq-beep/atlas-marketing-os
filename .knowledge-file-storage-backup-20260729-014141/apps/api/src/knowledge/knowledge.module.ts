import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeFileService } from './knowledge-file.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';

@Module({
  imports: [BrandsModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeFileService, KnowledgeEmbeddingService],
  exports: [KnowledgeService, KnowledgeEmbeddingService],
})
export class KnowledgeModule {}
