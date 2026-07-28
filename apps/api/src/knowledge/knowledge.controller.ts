import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateKnowledgeDocumentDto } from './dto/create-knowledge-document.dto';
import { UpdateKnowledgeDocumentDto } from './dto/update-knowledge-document.dto';
import { UploadKnowledgeDocumentDto } from './dto/upload-knowledge-document.dto';
import { KnowledgeFileService } from './knowledge-file.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeFileService: KnowledgeFileService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService,
  ) {}

  @Post()
  create(@Body() dto: CreateKnowledgeDocumentDto) {
    return this.knowledgeService.create(dto);
  }

  @Post('embeddings/backfill')
  backfillEmbeddings() {
    return this.knowledgeEmbeddingService.backfill();
  }

  @Post('embeddings/search')
  semanticSearch(
    @Body()
    body: {
      query: string;
      limit?: number;
      threshold?: number;
    },
  ) {
    return this.knowledgeEmbeddingService.semanticSearch(
      body,
    );
  }

  @Post(':id/embedding')
  embedDocument(@Param('id') id: string) {
    return this.knowledgeEmbeddingService.embedDocument(
      id,
    );
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKnowledgeDocumentDto,
  ) {
    return this.knowledgeFileService.upload(file, dto);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.knowledgeService.findAll({
      search,
      category,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.knowledgeService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeDocumentDto,
  ) {
    return this.knowledgeService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.knowledgeService.remove(id);
  }
}
