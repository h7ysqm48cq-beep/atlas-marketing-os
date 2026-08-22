import sharp from 'sharp';
import { AssetImageEditorService } from './asset-image-editor.service';

async function createHarness(textOverlayText: string) {
  const source = await sharp({
    create: {
      width: 320,
      height: 320,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const process = jest.fn((buffer: Buffer) => Promise.resolve(buffer));
  const sourceAsset = {
    id: 'asset-1',
    brandId: 'brand-1',
    name: 'copilot-generated-image',
    url: 'https://cdn.example.com/source.png',
    width: 320,
    height: 320,
    campaignId: null,
    historyId: null,
    platform: 'Facebook',
    prompt: 'Internal prompt',
    revisedPrompt: null,
    generationModel: 'gpt-image-2',
    generationQuality: 'medium',
    tags: ['ai-generated'],
  };
  const prisma = {
    asset: {
      findFirst: jest.fn(() => Promise.resolve(sourceAsset)),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'asset-2', ...data }),
      ),
    },
  };

  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(source),
    } as unknown as Response),
  ) as typeof fetch;

  const service = new AssetImageEditorService(
    prisma as never,
    {
      getActiveBrand: jest.fn(() =>
        Promise.resolve({
          id: 'brand-1',
          primaryLogoAssetId: null,
        }),
      ),
    } as never,
    {
      uploadImage: jest.fn(() =>
        Promise.resolve({
          provider: 'supabase',
          path: 'brands/brand-1/edited.png',
          publicUrl: 'https://cdn.example.com/edited.png',
          size: source.length,
        }),
      ),
    } as never,
    { get: jest.fn(() => null) } as never,
    {} as never,
    { process } as never,
    {
      get: jest.fn(() =>
        Promise.resolve({
          textOverlayEnabled: true,
          textOverlayText,
          brandFooterEnabled: false,
          footerLogoMode: 'hide',
        }),
      ),
    } as never,
  );

  return { service, process };
}

describe('AssetImageEditorService image generation settings', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('never burns a legacy internal asset name into edited image pixels', async () => {
    const harness = await createHarness('');

    await harness.service.compositeExistingAsset({
      assetId: 'asset-1',
      layers: [],
    });

    expect(harness.process).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        textOverlayEnabled: false,
      }),
      '',
    );
    expect(harness.process).not.toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(Object),
      expect.stringContaining('copilot-generated-image'),
    );
  });

  it('uses only explicit configured overlay copy for edited image versions', async () => {
    const harness = await createHarness('  今晚全力出击  ');

    await harness.service.compositeExistingAsset({
      assetId: 'asset-1',
      layers: [],
    });

    expect(harness.process).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        textOverlayEnabled: true,
      }),
      '今晚全力出击',
    );
  });
});
