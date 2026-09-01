import { ImageSettingsService } from './image-settings.service';

describe('ImageSettingsService workspace scope', () => {
  it('uses the authenticated current workspace instead of a globally active brand', async () => {
    const prisma = {
      brand: {
        findFirst: jest.fn().mockResolvedValue({
          workspaceId: 'workspace-b',
        }),
      },
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'workspace-b' }),
      },
      imageGenerationSetting: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({
            id: 'setting-a',
            workspaceId: where.workspaceId,
            pageId: null,
            channelId: null,
          }),
        ),
        create: jest.fn(),
      },
    } as any;
    const workspaceScope = {
      getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
    } as any;
    const service = new ImageSettingsService(prisma, workspaceScope);

    const result = await service.get();

    expect(result.workspaceId).toBe('workspace-a');
    expect(prisma.brand.findFirst).not.toHaveBeenCalled();
    expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
    expect(prisma.imageGenerationSetting.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'workspace-a',
        }),
      }),
    );
  });
});
