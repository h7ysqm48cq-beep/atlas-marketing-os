import { SocialPlatform } from '../generated/prisma/enums';
import { SportsNewsSettingsService } from './sports-news-settings.service';

function createService(prisma: Record<string, any>) {
  const service = new SportsNewsSettingsService(prisma as never);
  (service as any).workspaceScope = {
    getCurrentWorkspace: jest.fn().mockResolvedValue({
      id: 'workspace-a',
    }),
    getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
  };
  return service;
}

describe('SportsNewsSettingsService workspace scope', () => {
  it('uses the current workspace for settings instead of the oldest workspace', async () => {
    const prisma = {
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'workspace-b' }),
      },
      sportsNewsSetting: {
        upsert: jest.fn().mockResolvedValue({
          id: 'sports-a',
          workspaceId: 'workspace-a',
        }),
      },
    };
    const service = createService(prisma);

    const result = await service.get();

    expect(result.workspaceId).toBe('workspace-a');
    expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
    expect(prisma.sportsNewsSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-a',
        },
        create: {
          workspaceId: 'workspace-a',
        },
      }),
    );
  });

  it('lists only social channels from the current workspace', async () => {
    const prisma = {
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'workspace-b' }),
      },
      socialChannel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    await service.channels();

    expect(prisma.socialChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-a',
        },
      }),
    );
  });

  it('rejects a configured channel from another workspace', async () => {
    const prisma = {
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'workspace-b' }),
      },
      sportsNewsSetting: {
        upsert: jest.fn().mockResolvedValue({
          id: 'sports-a',
          workspaceId: 'workspace-a',
          storyMinimum: 3,
          storyMaximum: 5,
          telegramChannelId: null,
          facebookChannelId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastMorningRunAt: null,
          lastEveningRunAt: null,
          lastRunStatus: null,
          lastError: null,
        }),
        update: jest.fn(),
      },
      socialChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-b',
          workspaceId: 'workspace-b',
          platform: SocialPlatform.TELEGRAM,
        }),
        count: jest.fn(),
      },
    };
    const service = createService(prisma);

    await expect(
      service.update({
        telegramChannelId: 'channel-b',
      }),
    ).rejects.toThrow('Social channel not found.');

    expect(prisma.socialChannel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'channel-b',
        workspaceId: 'workspace-a',
      },
    });
    expect(prisma.sportsNewsSetting.update).not.toHaveBeenCalled();
  });
});
