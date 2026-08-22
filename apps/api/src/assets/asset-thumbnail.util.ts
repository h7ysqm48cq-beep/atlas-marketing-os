import sharp from 'sharp';

export const ASSET_THUMBNAIL_MAX_SIZE = 960;

export async function createAssetThumbnail(
  source: Buffer,
): Promise<Buffer> {
  return sharp(source, {
    failOn: 'none',
  })
    .rotate()
    .resize({
      width: ASSET_THUMBNAIL_MAX_SIZE,
      height: ASSET_THUMBNAIL_MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: 78,
      effort: 4,
    })
    .toBuffer();
}

export function buildAssetThumbnailPath(
  brandId: string,
  date: Date,
  key: string,
): string {
  const safeKey =
    key
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 120) ||
    'asset';

  return [
    'brands',
    brandId,
    'thumbnails',
    String(date.getUTCFullYear()),
    String(
      date.getUTCMonth() + 1,
    ).padStart(2, '0'),
    `${safeKey}.webp`,
  ].join('/');
}
