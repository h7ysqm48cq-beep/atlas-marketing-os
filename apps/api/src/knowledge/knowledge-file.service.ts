import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import mammoth from 'mammoth';
import { extname, parse as parsePath } from 'node:path';
import { PDFParse } from 'pdf-parse';
import { KnowledgeService } from './knowledge.service';
import { UploadKnowledgeDocumentDto } from './dto/upload-knowledge-document.dto';

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.docx',
  '.pdf',
]);

@Injectable()
export class KnowledgeFileService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async upload(
    file: Express.Multer.File | undefined,
    dto: UploadKnowledgeDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required.');
    }

    const extension = extname(file.originalname).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'Unsupported file type. Upload TXT, MD, DOCX or PDF.',
      );
    }

    const content = await this.extractText(file, extension);
    const cleanContent = this.cleanText(content);

    if (!cleanContent) {
      throw new BadRequestException(
        'No readable text could be extracted from this file.',
      );
    }

    const title =
      dto.title?.trim() ||
      this.filenameToTitle(file.originalname);

    const category =
      dto.category?.trim() || 'Imported Document';

    const tags = this.parseTags(dto.tags, extension);

    const document = await this.knowledgeService.create({
      title,
      category,
      content: cleanContent,
      tags,
    });

    return {
      document,
      upload: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        extension,
        size: file.size,
        extractedCharacters: cleanContent.length,
      },
    };
  }

  private async extractText(
    file: Express.Multer.File,
    extension: string,
  ) {
    if (
      extension === '.txt' ||
      extension === '.md' ||
      extension === '.markdown'
    ) {
      return file.buffer.toString('utf-8');
    }

    if (extension === '.docx') {
      try {
        const result = await mammoth.extractRawText({
          buffer: file.buffer,
        });

        return result.value;
      } catch (error) {
        throw new BadRequestException(
          `Unable to read DOCX file: ${this.errorMessage(error)}`,
        );
      }
    }

    if (extension === '.pdf') {
      const parser = new PDFParse({
        data: file.buffer,
      });

      try {
        const result = await parser.getText();
        return result.text;
      } catch (error) {
        throw new BadRequestException(
          `Unable to read PDF file: ${this.errorMessage(error)}`,
        );
      } finally {
        await parser.destroy();
      }
    }

    throw new BadRequestException('Unsupported file type.');
  }

  private parseTags(
    value: string | undefined,
    extension: string,
  ) {
    const suppliedTags = (value || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    return Array.from(
      new Set([
        'Imported',
        extension.replace('.', '').toUpperCase(),
        ...suppliedTags,
      ]),
    );
  }

  private filenameToTitle(filename: string) {
    const name = parsePath(filename).name
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return name || 'Imported knowledge document';
  }

  private cleanText(value: string) {
    return value
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  private errorMessage(error: unknown) {
    return error instanceof Error
      ? error.message
      : 'Unknown parsing error';
  }
}
