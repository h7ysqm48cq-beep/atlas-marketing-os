import {
  ScheduledPostStatus,
  SocialPlatform,
} from '../generated/prisma/enums';

jest.mock('./publisher.service', () => ({
  PublisherService: class PublisherService {},
}));

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

import { AutomationService } from './automation.service';

function createService(prisma: Record<string, any>) {
  const workspaceScope = {
    getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
  };

  return new AutomationService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    workspaceScope as never,
  );
}

describe('AutomationService workspace scope', () => {
  it('filters visible channels to the current workspace', async () => {
    const prisma = {
      socialChannel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    await service.listChannels();

    expect(prisma.socialChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-a',
          hiddenAt: null,
        },
      }),
    );
  });

  it('filters calendar posts to channels in the current workspace', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    await service.listCalendarPosts();

    expect(prisma.scheduledPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: {
            workspaceId: 'workspace-a',
            hiddenAt: null,
          },
        }),
      }),
    );
  });

  it('filters scheduled-post history to the current workspace', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    await service.listPosts();

    expect(prisma.scheduledPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: {
            workspaceId: 'workspace-a',
          },
        }),
      }),
    );
  });

  it('uses the current workspace for automation settings', async () => {
    const prisma = {
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'workspace-b' }),
      },
      automationSetting: {
        upsert: jest.fn().mockResolvedValue({
          id: 'settings-a',
          workspaceId: 'workspace-a',
        }),
      },
    };
    const service = createService(prisma);

    await service.getSettings();

    expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
    expect(prisma.automationSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-a',
        },
        create: expect.objectContaining({
          workspaceId: 'workspace-a',
        }),
      }),
    );
  });

  it('does not return a channel from another workspace', async () => {
    const prisma = {
      socialChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-b',
          workspaceId: 'workspace-b',
        }),
      },
    };
    const service = createService(prisma);

    await expect(service.getChannel('channel-b')).rejects.toThrow(
      'Social channel not found.',
    );

    expect(prisma.socialChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'channel-b',
          workspaceId: 'workspace-a',
        },
      }),
    );
  });

  it('does not return a scheduled post from another workspace', async () => {
    const prisma = {
      scheduledPost: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'post-b',
          status: ScheduledPostStatus.DRAFT,
          channel: {
            id: 'channel-b',
            workspaceId: 'workspace-b',
          },
        }),
      },
    };
    const service = createService(prisma);

    await expect(service.getPost('post-b')).rejects.toThrow(
      'Scheduled post not found.',
    );

    expect(prisma.scheduledPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'post-b',
          channel: {
            workspaceId: 'workspace-a',
          },
        },
      }),
    );
  });

  it('rejects scheduling against a channel outside the current workspace', async () => {
    const prisma = {
      socialChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-b',
          workspaceId: 'workspace-b',
          brandId: 'brand-1',
          platform: SocialPlatform.FACEBOOK,
        }),
      },
      scheduledPost: {
        create: jest.fn(),
      },
    };
    const service = createService(prisma);

    await expect(
      service.createPost({
        brandId: 'brand-1',
        channelId: 'channel-b',
        platform: SocialPlatform.FACEBOOK,
        content: 'Test',
        scheduledAt: '2026-09-02T12:00:00.000Z',
        status: ScheduledPostStatus.SCHEDULED,
      }),
    ).rejects.toThrow('Social channel not found.');

    expect(prisma.scheduledPost.create).not.toHaveBeenCalled();
  });
});
