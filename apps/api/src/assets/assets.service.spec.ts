import { AssetsService } from './assets.service';

describe('AssetsService.remove', () => {
  const asset = {
    id: 'asset-1',
    brandId: 'brand-1',
    campaignId: null,
    historyId: null,
    storagePath:
      'brands/brand-1/uploads/2026/09/asset-key.png',
    thumbnailUrl:
      'https://example.supabase.co/storage/v1/object/public/atlas-assets/brands/brand-1/thumbnails/2026/09/asset-key.webp',
  };

  function makeService(options?: {
    storageError?: Error;
  }) {
    const prisma = {
      asset: {
        findFirst: jest.fn().mockResolvedValue(asset),
        delete: jest.fn().mockResolvedValue(asset),
      },
    };
    const brandsService = {
      getActiveBrand: jest
        .fn()
        .mockResolvedValue({ id: 'brand-1' }),
    };
    const storageService = {
      removeMany: options?.storageError
        ? jest.fn().mockRejectedValue(options.storageError)
        : jest.fn().mockResolvedValue({
            deleted: true,
            paths: [],
          }),
    };

    return {
      service: new AssetsService(
        prisma as any,
        brandsService as any,
        storageService as any,
      ),
      prisma,
      storageService,
    };
  }

  it('removes original and thumbnail objects before deleting the Asset row', async () => {
    const { service, prisma, storageService } =
      makeService();

    await expect(
      service.remove('asset-1'),
    ).resolves.toEqual({
      deleted: true,
      id: 'asset-1',
    });

    expect(
      storageService.removeMany,
    ).toHaveBeenCalledWith([
      'brands/brand-1/uploads/2026/09/asset-key.png',
      'brands/brand-1/thumbnails/2026/09/asset-key.webp',
    ]);
    expect(
      storageService.removeMany.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      prisma.asset.delete.mock
        .invocationCallOrder[0],
    );
  });

  it('keeps the Asset row when Storage deletion fails', async () => {
    const storageError =
      new Error('storage delete failed');
    const { service, prisma } =
      makeService({ storageError });

    await expect(
      service.remove('asset-1'),
    ).rejects.toThrow(
      'storage delete failed',
    );

    expect(
      prisma.asset.delete,
    ).not.toHaveBeenCalled();
  });
});
