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


describe('SupabaseStorageService.health', () => {
  function serviceWithClient(
    client: unknown,
    bucket = 'atlas-assets',
  ) {
    const service = new SupabaseStorageService({
      get: jest.fn(),
    } as any);

    (service as any).client = client;
    (service as any).bucket = bucket;

    return service;
  }

  it('reports critical when Supabase Storage is not configured', async () => {
    const service = serviceWithClient(null);

    await expect(service.health()).resolves.toEqual({
      status: 'critical',
      provider: 'supabase',
      bucket: 'atlas-assets',
      configured: false,
      message: 'Supabase Storage is not configured.',
    });
  });

  it('reports healthy when the bucket can be listed read-only', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [],
      error: null,
    });

    const from = jest.fn(() => ({
      list,
    }));

    const service = serviceWithClient({
      storage: {
        from,
      },
    });

    await expect(service.health()).resolves.toEqual({
      status: 'healthy',
      provider: 'supabase',
      bucket: 'atlas-assets',
      configured: true,
      message: null,
    });

    expect(from).toHaveBeenCalledWith('atlas-assets');
    expect(list).toHaveBeenCalledWith('', {
      limit: 1,
      offset: 0,
    });
  });

  it('reports critical when the bucket read probe fails', async () => {
    const service = serviceWithClient({
      storage: {
        from: jest.fn(() => ({
          list: jest.fn().mockResolvedValue({
            data: null,
            error: {
              message: 'bucket unavailable',
            },
          }),
        })),
      },
    });

    await expect(service.health()).resolves.toEqual({
      status: 'critical',
      provider: 'supabase',
      bucket: 'atlas-assets',
      configured: true,
      message: 'bucket unavailable',
    });
  });
});
