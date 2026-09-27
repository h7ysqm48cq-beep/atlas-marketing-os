import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  UploadedFile,
  UploadFileInput,
  UploadImageInput,
} from './storage.types';

@Injectable()
export class SupabaseStorageService {
  private readonly client: SupabaseClient | null;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');

    const serviceRoleKey =
      this.configService.get<string>('SUPABASE_SECRET_KEY') ||
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    this.bucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET') ||
      'atlas-assets';

    this.client =
      supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          })
        : null;
  }

  async health() {
    if (!this.client) {
      return {
        status: 'critical',
        provider: 'supabase',
        bucket: this.bucket,
        configured: false,
        message: 'Supabase Storage is not configured.',
      };
    }

    const { error } = await this.client.storage
      .from(this.bucket)
      .list('', {
        limit: 1,
        offset: 0,
      });

    if (error) {
      return {
        status: 'critical',
        provider: 'supabase',
        bucket: this.bucket,
        configured: true,
        message: error.message,
      };
    }

    return {
      status: 'healthy',
      provider: 'supabase',
      bucket: this.bucket,
      configured: true,
      message: null,
    };
  }

  async uploadImage(input: UploadImageInput): Promise<UploadedFile> {
    return this.uploadFile(input);
  }

  async uploadFile(input: UploadFileInput): Promise<UploadedFile> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Supabase Storage is not configured.',
      );
    }

    const normalizedPath = input.path.replace(/^\/+/, '');

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(normalizedPath, input.buffer, {
        contentType: input.contentType,
        cacheControl: input.cacheControl || '31536000',
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Supabase upload failed: ${error.message}`,
      );
    }

    const { data } = this.client.storage
      .from(this.bucket)
      .getPublicUrl(normalizedPath);

    if (!data.publicUrl) {
      throw new InternalServerErrorException(
        'Supabase did not return a public URL.',
      );
    }

    return {
      provider: 'supabase',
      bucket: this.bucket,
      path: normalizedPath,
      publicUrl: data.publicUrl,
      size: input.buffer.length,
      contentType: input.contentType,
    };
  }

  async download(path: string): Promise<Buffer> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Supabase Storage is not configured.',
      );
    }

    const normalizedPath = path.replace(/^\/+/, '');

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(normalizedPath);

    if (error || !data) {
      throw new InternalServerErrorException(
        `Supabase download failed: ${
          error?.message || 'File data was not returned.'
        }`,
      );
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async removeMany(paths: string[]) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Supabase Storage is not configured.',
      );
    }

    const normalizedPaths = [
      ...new Set(
        paths
          .map((path) =>
            path.replace(/^\/+/, '').trim(),
          )
          .filter(Boolean),
      ),
    ];

    if (normalizedPaths.length === 0) {
      return {
        deleted: true,
        bucket: this.bucket,
        paths: normalizedPaths,
      };
    }

    const { error } = await this.client.storage
      .from(this.bucket)
      .remove(normalizedPaths);

    if (error) {
      throw new InternalServerErrorException(
        `Supabase delete failed: ${error.message}`,
      );
    }

    return {
      deleted: true,
      bucket: this.bucket,
      paths: normalizedPaths,
    };
  }

  async remove(path: string) {
    const result = await this.removeMany([path]);

    return {
      deleted: true,
      bucket: result.bucket,
      path: result.paths[0],
    };
  }
}
