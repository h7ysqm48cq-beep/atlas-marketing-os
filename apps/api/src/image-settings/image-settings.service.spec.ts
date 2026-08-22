import { ImageSettingsService } from './image-settings.service';

describe('ImageSettingsService text overlay copy', () => {
  it('stores normalized explicit overlay text on the selected scope', async () => {
    const prisma = {
      brand: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            workspaceId: 'workspace-1',
          }),
        ),
      },
      imageGenerationSetting: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: 'setting-1',
          }),
        ),
        update: jest.fn(({ data }) =>
          Promise.resolve({
            id: 'setting-1',
            ...data,
          }),
        ),
      },
    };
    const service = new ImageSettingsService(prisma as never);

    await service.update({
      textOverlayEnabled: true,
      textOverlayText: '  今晚全力出击  ',
    });

    expect(prisma.imageGenerationSetting.update).toHaveBeenCalledWith({
      where: {
        id: 'setting-1',
      },
      data: {
        textOverlayEnabled: true,
        textOverlayText: '今晚全力出击',
      },
    });
  });

  it('normalizes multiple QR links to unique http(s) URLs and keeps at most three', async () => {
    const prisma = {
      brand: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            workspaceId: 'workspace-1',
          }),
        ),
      },
      imageGenerationSetting: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: 'setting-1',
          }),
        ),
        update: jest.fn(({ data }) =>
          Promise.resolve({
            id: 'setting-1',
            ...data,
          }),
        ),
      },
    };
    const service = new ImageSettingsService(prisma as never);

    await service.update({
      qrEnabled: true,
      qrLinks: [
        ' https://mgmbetmyr.com ',
        'https://mgmbetmyr.com',
        'mailto:invalid@example.com',
        'https://t.me/atlas',
        'https://example.com/third',
        'https://example.com/ignored',
      ].join('\n'),
    });

    expect(prisma.imageGenerationSetting.update).toHaveBeenCalledWith({
      where: {
        id: 'setting-1',
      },
      data: {
        qrEnabled: true,
        qrLinks:
          'https://mgmbetmyr.com\nhttps://t.me/atlas\nhttps://example.com/third',
      },
    });
  });
});
