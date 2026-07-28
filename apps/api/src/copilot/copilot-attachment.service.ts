import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrandsService } from '../brands/brands.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class CopilotAttachmentService {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly storageService: SupabaseStorageService,
  ) {}

  async uploadImage(file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('An image file is required.');
    }

    if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Upload PNG, JPG, WEBP or GIF images only.',
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Image size must not exceed 10 MB.');
    }

    const brand = await this.brandsService.getActiveBrand();

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    const extension = this.safeExtension(file.originalname, file.mimetype);

    const safeName = this.slugify(file.originalname) || 'copilot-attachment';

    const filename =
      [Date.now(), safeName, randomBytes(4).toString('hex')].join('-') +
      extension;

    const path = ['brands', brand.id, 'copilot', year, month, filename].join(
      '/',
    );

    const uploaded = await this.storageService.uploadFile({
      buffer: file.buffer,
      path,
      contentType: file.mimetype,
    });

    return {
      id: randomBytes(8).toString('hex'),
      kind: 'image',
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: uploaded.publicUrl,
      storageProvider: uploaded.provider,
      storagePath: uploaded.path,
    };
  }

  private slugify(value: string) {
    return value
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 70);
  }

  private safeExtension(filename: string, mimeType: string) {
    const original = extname(filename).toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(original)) {
      return original;
    }

    const extensions: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };

    return extensions[mimeType] || '.bin';
  }
}
