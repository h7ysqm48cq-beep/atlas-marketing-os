import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { StorageModule } from '../storage/storage.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeFileService } from './knowledge-file.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [BrandsModule, StorageModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeFileService,
    KnowledgeEmbeddingService,
    KnowledgeRetrievalService,
  ],
  exports: [
    KnowledgeService,
    KnowledgeEmbeddingService,
    KnowledgeRetrievalService,
  ],
})
export class KnowledgeModule {}
