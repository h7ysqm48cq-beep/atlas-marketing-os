import { NotFoundException } from '@nestjs/common';
import { AuthContextService } from '../auth/auth-context.service';
import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';
import { WorkspaceScopedAutomationService } from './workspace-scoped-automation.service';

function createService() {
  const prisma = {
    workspace: {
      findUnique: jest.fn(),
    },
    brand: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    socialChannel: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    scheduledPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    automationSetting: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
  const auth = new AuthContextService();
  const service = new WorkspaceScopedAutomationService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    auth,
  );

  return { prisma, auth, service };
}

describe('WorkspaceScopedAutomationService', () => {
  it('fails closed when an authenticated user has no owned workspace', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue(null);

    await expect(
      auth.run('user-a', () => service.listChannels()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters channels to the authenticated workspace and keeps hidden filtering in the base query', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.socialChannel.findMany.mockResolvedValue([
      {
        id: 'channel-a',
        workspaceId: 'workspace-a',
        accessTokenEncrypted: null,
      },
      {
        id: 'channel-b',
        workspaceId: 'workspace-b',
        accessTokenEncrypted: null,
      },
    ]);

    const result = await auth.run('user-a', () => service.listChannels());

    expect(result.map((channel) => channel.id)).toEqual(['channel-a']);
    expect(prisma.socialChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hiddenAt: null } }),
    );
  });

  it('filters calendar posts to brands in the authenticated workspace', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.brand.findMany.mockResolvedValue([{ id: 'brand-a' }]);
    prisma.scheduledPost.findMany.mockResolvedValue([
      {
        id: 'post-a',
        brandId: 'brand-a',
        mediaUrls: [],
        channel: { id: 'channel-a', name: 'A' },
        campaign: null,
      },
      {
        id: 'post-b',
        brandId: 'brand-b',
        mediaUrls: [],
        channel: { id: 'channel-b', name: 'B' },
        campaign: null,
      },
    ]);

    const result = await auth.run('user-a', () => service.listCalendarPosts());

    expect(result.map((post) => post.id)).toEqual(['post-a']);
  });

  it('blocks a cross-workspace scheduled post before returning it', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.scheduledPost.findFirst.mockResolvedValue(null);

    await expect(
      auth.run('user-a', () => service.getPost('post-b')),
    ).rejects.toThrow('Scheduled post not found.');
  });

  it('rejects creating a SCHEDULED post in the past', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });

    await expect(
      auth.run('user-a', () =>
        service.createPost({
          brandId: 'brand-a',
          channelId: 'channel-a',
          platform: SocialPlatform.FACEBOOK,
          content: 'Test',
          scheduledAt: new Date(Date.now() - 60_000).toISOString(),
          status: ScheduledPostStatus.SCHEDULED,
        }),
      ),
    ).rejects.toThrow('future scheduledAt');

    expect(prisma.scheduledPost.create).not.toHaveBeenCalled();
  });

  it('allows a historical DRAFT timestamp after workspace validation', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.brand.findFirst.mockResolvedValue({ id: 'brand-a' });
    prisma.socialChannel.findFirst.mockResolvedValue({ id: 'channel-a' });
    prisma.socialChannel.findUnique.mockResolvedValue({
      id: 'channel-a',
      brandId: 'brand-a',
      platform: SocialPlatform.FACEBOOK,
    });
    prisma.scheduledPost.create.mockResolvedValue({
      id: 'post-a',
      platform: SocialPlatform.FACEBOOK,
      scheduledAt: new Date(Date.now() - 60_000),
      channel: { id: 'channel-a', name: 'Facebook' },
    });

    await expect(
      auth.run('user-a', () =>
        service.createPost({
          brandId: 'brand-a',
          channelId: 'channel-a',
          platform: SocialPlatform.FACEBOOK,
          content: 'Draft',
          scheduledAt: new Date(Date.now() - 60_000).toISOString(),
          status: ScheduledPostStatus.DRAFT,
        }),
      ),
    ).resolves.toMatchObject({ id: 'post-a' });
  });

  it('uses the authenticated workspace for automation settings', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.automationSetting.upsert.mockResolvedValue({
      id: 'setting-a',
      workspaceId: 'workspace-a',
    });

    await auth.run('user-a', () => service.getSettings());

    expect(prisma.automationSetting.upsert).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-a' },
      update: {},
      create: { workspaceId: 'workspace-a' },
    });
  });

  it('falls back to the original system behavior when there is no HTTP auth context', async () => {
    const { prisma, service } = createService();
    prisma.socialChannel.findMany.mockResolvedValue([]);

    await expect(service.listChannels()).resolves.toEqual([]);
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });
});
