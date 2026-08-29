import { AssetImageEditorService } from './asset-image-editor.service';

describe('AssetImageEditorService uploaded asset persistence', () => {
  it('removes the uploaded file when asset persistence fails', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const storageService = { remove };
    const service = new AssetImageEditorService(
      {} as never,
      {} as never,
      storageService as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const persistUploadedAsset = (
      service as unknown as {
        persistUploadedAsset: (
          uploaded: { path: string },
          create: () => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).persistUploadedAsset;

    await expect(
      persistUploadedAsset.call(
        service,
        { path: 'brands/brand-1/edited.png' },
        async () => {
          throw new Error('database unavailable');
        },
      ),
    ).rejects.toThrow('database unavailable');

    expect(remove).toHaveBeenCalledWith('brands/brand-1/edited.png');
  });
});
