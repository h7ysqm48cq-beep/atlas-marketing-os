import { SupabaseStorageService } from './supabase-storage.service';

describe('SupabaseStorageService.removeMany', () => {
  it('deletes normalized object paths in one Storage API request', async () => {
    const remove = jest
      .fn()
      .mockResolvedValue({ error: null });
    const from = jest.fn(() => ({
      remove,
    }));
    const service =
      new SupabaseStorageService({
        get: jest.fn(),
      } as any);

    (service as any).client = {
      storage: { from },
    };
    (service as any).bucket =
      'atlas-assets';

    await expect(
      (service as any).removeMany([
        '/brands/brand-1/uploads/a.png',
        'brands/brand-1/thumbnails/a.webp',
      ]),
    ).resolves.toEqual({
      deleted: true,
      bucket: 'atlas-assets',
      paths: [
        'brands/brand-1/uploads/a.png',
        'brands/brand-1/thumbnails/a.webp',
      ],
    });

    expect(from).toHaveBeenCalledWith(
      'atlas-assets',
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([
      'brands/brand-1/uploads/a.png',
      'brands/brand-1/thumbnails/a.webp',
    ]);
  });
});
