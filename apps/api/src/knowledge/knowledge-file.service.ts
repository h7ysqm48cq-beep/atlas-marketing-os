import { BadRequestException, Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import { extname, parse as parsePath } from 'node:path';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { BrandsService } from '../brands/brands.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { UploadKnowledgeDocumentDto } from './dto/upload-knowledge-document.dto';
import { KnowledgeService } from './knowledge.service';

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.docx',
  '.pdf',
  '.xlsx',
  '.xls',
]);

@Injectable()
export class KnowledgeFileService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
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
        'Unsupported file type. Upload TXT, MD, DOCX, PDF, XLSX or XLS.',
      );
    }

    const content = await this.extractText(file, extension);

    const cleanContent = this.cleanText(content);

    if (!cleanContent) {
      throw new BadRequestException(
        'No readable text could be extracted from this file.',
      );
    }

    const brand = await this.brandsService.getActiveBrand();

    const title = dto.title?.trim() || this.filenameToTitle(file.originalname);

    const category = dto.category?.trim() || 'Imported Document';

    const tags = this.parseTags(dto.tags, extension);

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    const safeFilename = this.storageFilename(file.originalname);

    const storagePath = [
      'brands',
      brand.id,
      'knowledge',
      year,
      month,
      `${Date.now()}-${safeFilename}`,
    ].join('/');

    const uploaded = await this.storageService.uploadFile({
      buffer: file.buffer,
      path: storagePath,
      contentType: file.mimetype || this.mimeTypeFor(extension),
    });

    try {
      const document = await this.knowledgeService.create({
        title,
        category,
        content: cleanContent,
        tags,
        sourceFileName: file.originalname,
        sourceMimeType: file.mimetype || this.mimeTypeFor(extension),
        sourceFileSize: file.size,
        sourceUrl: uploaded.publicUrl,
        storageProvider: uploaded.provider,
        storagePath: uploaded.path,
      });

      return {
        document,
        upload: {
          originalName: file.originalname,
          mimeType: file.mimetype,
          extension,
          size: file.size,
          extractedCharacters: cleanContent.length,
          storageProvider: uploaded.provider,
          storagePath: uploaded.path,
          url: uploaded.publicUrl,
        },
      };
    } catch (error) {
      await this.storageService.remove(uploaded.path).catch(() => {});

      throw error;
    }
  }

  private async extractText(file: Express.Multer.File, extension: string) {
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

    if (extension === '.xlsx' || extension === '.xls') {
      try {
        const workbook = XLSX.read(file.buffer, {
          type: 'buffer',
          cellDates: true,
        });

        const sheets = workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];

          if (!sheet) {
            return '';
          }

          const csv = XLSX.utils.sheet_to_csv(sheet, {
            blankrows: false,
          });

          const cleanCsv = csv.trim();

          if (!cleanCsv) {
            return '';
          }

          return [`Sheet: ${sheetName}`, cleanCsv].join('\n');
        }).filter(Boolean);

        return sheets.join('\n\n');
      } catch (error) {
        throw new BadRequestException(
          `Unable to read Excel file: ${this.errorMessage(error)}`,
        );
      }
    }

    throw new BadRequestException('Unsupported file type.');
  }

  private parseTags(value: string | undefined, extension: string) {
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

  private storageFilename(filename: string) {
    const extension = extname(filename).toLowerCase();

    const base = parsePath(filename)
      .name.normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80);

    return `${base || 'knowledge-document'}${extension}`;
  }

  private filenameToTitle(filename: string) {
    const name = parsePath(filename)
      .name.replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return name || 'Imported knowledge document';
  }

  private mimeTypeFor(extension: string) {
    const types: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.markdown': 'text/markdown',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pdf': 'application/pdf',
      '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
    };

    return types[extension] || 'application/octet-stream';
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
    return error instanceof Error ? error.message : 'Unknown parsing error';
  }
}
