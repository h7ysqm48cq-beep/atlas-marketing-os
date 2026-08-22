import { BrandRendererService } from './brand-renderer.service';

describe('BrandRendererService official logo loading', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('loads the active brand primary logo for post-processing', async () => {
    const logoBytes = Buffer.from('official-logo');
    const prisma = {
      asset: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            url: 'https://cdn.example.com/logo.png',
          }),
        ),
      },
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(logoBytes),
      } as unknown as Response),
    ) as typeof fetch;

    const service = new BrandRendererService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.loadPrimaryLogoBuffer({
        brandId: 'brand-1',
        primaryLogoAssetId: 'logo-1',
      }),
    ).resolves.toEqual(logoBytes);
    expect(prisma.asset.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'logo-1',
        brandId: 'brand-1',
        type: 'IMAGE',
      },
      select: { url: true },
    });
  });

  it('uses the explicit active-brand logo id when rendering an existing asset', async () => {
    const logoBuffer = Buffer.from('official-logo');
    const overlay = jest.fn(({ image }: { image: Buffer }) =>
      Promise.resolve(image),
    );
    const service = new BrandRendererService(
      {} as never,
      { overlay } as never,
      {
        resolve: jest.fn(() => ({
          brandFooterEnabled: false,
          footerText: null,
          footerPosition: 'bottom-center',
          footerStyle: 'minimal',
          footerLogoMode: 'auto',
          logoEnabled: true,
          primaryLogoAssetId: null,
        })),
      },
      {
        render: jest.fn(({ image }: { image: Buffer }) =>
          Promise.resolve(image),
        ),
      },
      {} as never,
      {
        resolve: jest.fn(() => ({
          imagePolicy: {
            logoEnabled: true,
            footerEnabled: true,
          },
        })),
      },
    );
    const loadPrimaryLogoBuffer = jest
      .spyOn(service, 'loadPrimaryLogoBuffer')
      .mockResolvedValue(logoBuffer);

    await service.render(
      {
        brandId: 'brand-1',
        imageWidth: 640,
        imageHeight: 640,
        buffer: Buffer.from('image'),
      },
      {
        logoEnabled: true,
        primaryLogoAssetId: 'logo-1',
      },
    );

    expect(loadPrimaryLogoBuffer).toHaveBeenCalledWith({
      brandId: 'brand-1',
      primaryLogoAssetId: 'logo-1',
    });
    expect(overlay).toHaveBeenCalledWith(
      expect.objectContaining({
        logo: logoBuffer,
      }),
    );
  });
});
