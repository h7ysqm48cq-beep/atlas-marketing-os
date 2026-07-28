export type UploadFileInput = {
  buffer: Buffer;
  path: string;
  contentType: string;
  cacheControl?: string;
};

export type UploadedFile = {
  provider: 'supabase';
  bucket: string;
  path: string;
  publicUrl: string;
  size: number;
  contentType: string;
};

export type UploadImageInput =
  UploadFileInput;
