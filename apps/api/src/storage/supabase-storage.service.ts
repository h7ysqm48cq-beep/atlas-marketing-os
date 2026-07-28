import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { UploadedFile, UploadImageInput } from './storage.types';

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

  async uploadImage(input: UploadImageInput): Promise<UploadedFile> {
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

  async remove(path: string) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Supabase Storage is not configured.',
      );
    }

    const normalizedPath = path.replace(/^\/+/, '');

    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([normalizedPath]);

    if (error) {
      throw new InternalServerErrorException(
        `Supabase delete failed: ${error.message}`,
      );
    }

    return {
      deleted: true,
      bucket: this.bucket,
      path: normalizedPath,
    };
  }
}
