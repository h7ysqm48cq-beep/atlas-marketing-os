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
});
