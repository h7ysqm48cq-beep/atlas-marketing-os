import sharp from 'sharp';
import { AssetImageService } from './asset-image.service';

async function createHarness(imageSetting: Record<string, unknown>) {
  const sourceImage = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 32, g: 48, b: 64, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const logoBuffer = Buffer.from('official-logo');

  const brandRenderer = {
    loadPrimaryLogoBuffer: jest.fn(() => Promise.resolve(logoBuffer)),
    render: jest.fn(
      (
        {
          buffer,
        }: {
          buffer: Buffer;
          workspaceSetting?: Record<string, unknown>;
        },
        _options?: Record<string, unknown>,
      ) => {
        void _options;
        return Promise.resolve(buffer);
      },
    ),
  };
  const prisma = {
    asset: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'asset-1', ...data }),
      ),
      findFirst: jest.fn(),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'asset-1', ...data }),
      ),
    },
  };
  const storageService = {
    uploadImage: jest.fn(
      ({
        buffer,
        path,
        contentType,
      }: {
        buffer: Buffer;
        path: string;
        contentType: string;
      }) =>
        Promise.resolve({
          provider: 'supabase',
          path,
          publicUrl: `https://example.com/${path}`,
          size: buffer.length,
          contentType,
        }),
    ),
    download: jest.fn(() => Promise.resolve(sourceImage)),
    remove: jest.fn(),
  };
  const imagePostProcessor = {
    process: jest.fn((buffer: Buffer) => Promise.resolve(buffer)),
  };
  const generate = jest.fn(() =>
    Promise.resolve({
      data: [{ b64_json: sourceImage.toString('base64') }],
    }),
  );

  const service = new AssetImageService(
    brandRenderer as never,
    {
      get: jest.fn((key) => (key === 'OPENAI_API_KEY' ? 'test-key' : null)),
    } as never,
    prisma as never,
    {
      getActiveBrand: jest.fn(() =>
        Promise.resolve({
          id: 'brand-1',
          primaryLogoAssetId: 'logo-1',
        }),
      ),
    } as never,
    storageService as never,
    {} as never,
    {
      getImageModel: jest.fn(() => Promise.resolve('gpt-image-2')),
      applyImageGenerationPolicy: jest.fn((prompt: string) =>
        Promise.resolve({
          prompt,
          modelLogoEnabled: false,
          atlasLogoOverlayEnabled: true,
        }),
      ),
    } as never,
    {
      get: jest.fn(() => Promise.resolve(imageSetting)),
    } as never,
    imagePostProcessor as never,
  );

  Object.defineProperty(service, 'client', {
    value: {
      images: {
        generate,
      },
    },
  });

  return {
    service,
    sourceImage,
    logoBuffer,
    brandRenderer,
    imagePostProcessor,
    generate,
    prisma,
    storageService,
  };
}

const baseSetting = {
  textOverlayEnabled: true,
  textOverlayText: '',
  brandFooterEnabled: true,
  footerText: 'Official brand footer',
  footerPosition: 'bottom-center',
  footerStyle: 'minimal',
  footerLogoMode: 'auto',
  cornerLogoEnabled: true,
  cornerLogoPlacement: 'TOP_RIGHT',
  cornerLogoScale: 1,
  cornerLogoOpacity: 0.9,
};

describe('AssetImageService image post-processing', () => {
  it('never falls back to internal asset metadata for text overlays', async () => {
    const harness = await createHarness(baseSetting);

    await harness.service.generateAndSave({
      name: 'copilot-generated-image',
      prompt: 'Create a clean visual without text.',
      platform: 'Facebook',
      textOverlayMode: 'AUTO',
    });

    expect(harness.imagePostProcessor.process).toHaveBeenCalledWith(
      harness.sourceImage,
      expect.objectContaining({
        textOverlayEnabled: false,
        brandFooterEnabled: true,
      }),
      '',
    );
  });

  it('renders explicit overlay copy, footer signature logo, and corner logo independently', async () => {
    const harness = await createHarness({
      ...baseSetting,
      textOverlayText: '今晚全力出击',
    });

    const result = await harness.service.generateAndSave({
      name: 'Internal asset name',
      prompt: 'Create a clean campaign visual.',
      platform: 'Facebook',
      textOverlayMode: 'AUTO',
      logoMode: 'AUTO',
    });

    expect(harness.brandRenderer.loadPrimaryLogoBuffer).toHaveBeenCalledWith({
      brandId: 'brand-1',
      primaryLogoAssetId: 'logo-1',
    });
    expect(harness.imagePostProcessor.process).toHaveBeenCalledWith(
      harness.sourceImage,
      expect.objectContaining({
        textOverlayEnabled: true,
        brandFooterEnabled: true,
        footerText: 'Official brand footer',
        brandLogo: harness.logoBuffer,
        logoEnabled: true,
      }),
      '今晚全力出击',
    );
    const [renderContext, renderOptions] =
      harness.brandRenderer.render.mock.calls[0];
    expect(renderContext.workspaceSetting).toEqual(
      expect.objectContaining({
        brandFooterEnabled: false,
        primaryLogoAssetId: 'logo-1',
      }),
    );
    expect(renderOptions).toEqual(
      expect.objectContaining({
        logoEnabled: true,
        logoBuffer: harness.logoBuffer,
        placement: 'TOP_RIGHT',
        scale: 1,
        opacity: 0.9,
        platform: 'Facebook',
      }),
    );
    expect(result.asset.tags).toEqual(
      expect.arrayContaining(['text-overlay-enabled', 'corner-logo-overlay']),
    );
  });

  it('keeps a clean source and reapplies save-time branding without calling the image provider', async () => {
    const harness = await createHarness(baseSetting);
    const generated = await harness.service.generateAndSave({
      name: 'Save-time branding',
      prompt: 'Create a clean campaign visual.',
      platform: 'Facebook',
    });
    const providerCalls = harness.generate.mock.calls.length;

    expect(generated.asset.tags).toEqual(
      expect.arrayContaining([expect.stringMatching(/^atlas-source-path:/)]),
    );

    harness.prisma.asset.findFirst.mockResolvedValue(generated.asset);
    harness.imagePostProcessor.process.mockClear();
    harness.brandRenderer.render.mockClear();

    const result = await harness.service.updateBranding('asset-1', {
      brandFooterEnabled: false,
      footerLogoEnabled: false,
      cornerLogoEnabled: false,
    });

    expect(harness.storageService.download).toHaveBeenCalledWith(
      expect.stringContaining('/sources/'),
    );
    expect(harness.generate).toHaveBeenCalledTimes(providerCalls);
    expect(harness.imagePostProcessor.process).toHaveBeenCalledWith(
      harness.sourceImage,
      expect.objectContaining({
        brandFooterEnabled: false,
        logoEnabled: false,
      }),
      '',
    );
    expect(harness.brandRenderer.render).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        logoEnabled: false,
      }),
    );
    expect(result.branding).toEqual({
      brandFooterEnabled: false,
      footerLogoEnabled: false,
      cornerLogoEnabled: false,
    });
  });

  it('rejects save-time branding for legacy images without a clean source', async () => {
    const harness = await createHarness(baseSetting);

    harness.prisma.asset.findFirst.mockResolvedValue({
      id: 'legacy-asset',
      brandId: 'brand-1',
      type: 'IMAGE',
      tags: ['ai-generated'],
    });

    await expect(
      harness.service.updateBranding('legacy-asset', {
        brandFooterEnabled: true,
        footerLogoEnabled: true,
        cornerLogoEnabled: false,
      }),
    ).rejects.toThrow('Regenerate it once');
    expect(harness.storageService.download).not.toHaveBeenCalled();
  });

  it('selects a provider canvas by orientation and saves the requested final resolution', async () => {
    const harness = await createHarness(baseSetting);

    const result = await harness.service.generateAndSave({
      name: 'Dynamic landscape',
      prompt: 'Create a landscape campaign visual.',
      platform: 'Facebook',
      aspectRatio: '16:9',
    });

    expect(harness.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        size: '1536x1024',
      }),
    );
    expect(harness.brandRenderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        imageWidth: 1536,
        imageHeight: 864,
      }),
      expect.any(Object),
    );
    expect(result.asset).toEqual(
      expect.objectContaining({
        width: 1536,
        height: 864,
      }),
    );
    expect(result.generation).toEqual(
      expect.objectContaining({
        outputWidth: 1536,
        outputHeight: 864,
        aspectRatio: '16:9',
      }),
    );
  });

  it('preserves the supported ratio boundary and rejects ratios it cannot preserve', async () => {
    const boundaryHarness = await createHarness(baseSetting);

    const result = await boundaryHarness.service.generateAndSave({
      name: 'Wide boundary',
      prompt: 'Create an extra-wide campaign visual.',
      platform: 'Facebook',
      aspectRatio: '6:1',
    });

    expect(result.asset).toEqual(
      expect.objectContaining({
        width: 1536,
        height: 256,
      }),
    );

    const rejectedHarness = await createHarness(baseSetting);

    await expect(
      rejectedHarness.service.generateAndSave({
        name: 'Unsupported ratio',
        prompt: 'Create an impossibly wide campaign visual.',
        platform: 'Facebook',
        aspectRatio: '7:1',
      }),
    ).rejects.toThrow(
      'aspectRatio must be between 1:6 and 6:1 so the requested ratio can be preserved.',
    );
    expect(rejectedHarness.generate).not.toHaveBeenCalled();
  });

  it('rejects conflicting exact dimensions and aspect ratio inputs', async () => {
    const harness = await createHarness(baseSetting);

    await expect(
      harness.service.generateAndSave({
        name: 'Conflicting output request',
        prompt: 'Create a campaign visual.',
        platform: 'Facebook',
        outputWidth: 1920,
        outputHeight: 1080,
        aspectRatio: '1:1',
      }),
    ).rejects.toThrow(
      'Use either outputWidth/outputHeight or aspectRatio, not both.',
    );
    expect(harness.generate).not.toHaveBeenCalled();
  });
});
