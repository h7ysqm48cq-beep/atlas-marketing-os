import { NotFoundException } from '@nestjs/common';
import { AuthContextService } from '../auth/auth-context.service';
import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';

jest.mock('./publisher.service', () => ({
  PublisherService: class PublisherService {},
}));

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

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

function allowFacebookPost(prisma: ReturnType<typeof createService>['prisma']) {
  prisma.brand.findFirst.mockResolvedValue({ id: 'brand-a' });
  prisma.socialChannel.findFirst.mockResolvedValue({ id: 'channel-a' });
  prisma.socialChannel.findUnique.mockResolvedValue({
    id: 'channel-a',
    brandId: 'brand-a',
    platform: SocialPlatform.FACEBOOK,
  });
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

  it('applies workspace and hidden-channel predicates before calendar limits', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.scheduledPost.findMany.mockResolvedValue([
      {
        id: 'post-a',
        brandId: 'brand-a',
        mediaUrls: [],
        channel: { id: 'channel-a', name: 'A' },
        campaign: null,
      },
    ]);

    const result = await auth.run('user-a', () =>
      service.listCalendarPosts(undefined, undefined, undefined, 10),
    );

    expect(result.map((post) => post.id)).toEqual(['post-a']);
    expect(prisma.scheduledPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brand: { workspaceId: 'workspace-a' },
          channel: {
            workspaceId: 'workspace-a',
            hiddenAt: null,
          },
        }),
        take: 10,
      }),
    );
  });

  it('applies workspace predicates before normal post list limits', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.scheduledPost.findMany.mockResolvedValue([]);

    await auth.run('user-a', () => service.listPosts());

    expect(prisma.scheduledPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brand: { workspaceId: 'workspace-a' },
          channel: { workspaceId: 'workspace-a' },
        }),
      }),
    );
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

  it('allows a valid future SCHEDULED post after workspace validation', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    allowFacebookPost(prisma);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    prisma.scheduledPost.create.mockResolvedValue({
      id: 'post-future',
      brandId: 'brand-a',
      channelId: 'channel-a',
      platform: SocialPlatform.FACEBOOK,
      content: 'Future',
      mediaUrls: [],
      scheduledAt: future,
      timezone: 'Asia/Kuala_Lumpur',
      status: ScheduledPostStatus.SCHEDULED,
      channel: { id: 'channel-a', name: 'Facebook' },
      brand: { id: 'brand-a', name: 'Brand' },
      campaign: null,
    });

    await expect(
      auth.run('user-a', () =>
        service.createPost({
          brandId: 'brand-a',
          channelId: 'channel-a',
          platform: SocialPlatform.FACEBOOK,
          content: 'Future',
          scheduledAt: future.toISOString(),
          status: ScheduledPostStatus.SCHEDULED,
        }),
      ),
    ).resolves.toMatchObject({ id: 'post-future' });
  });

  it('rejects moving a SCHEDULED post to a past timestamp', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    prisma.scheduledPost.findFirst.mockResolvedValue({ id: 'post-a' });
    prisma.scheduledPost.findUnique.mockResolvedValue({
      id: 'post-a',
      brandId: 'brand-a',
      channelId: 'channel-a',
      platform: SocialPlatform.FACEBOOK,
      content: 'Scheduled',
      mediaUrls: [],
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      timezone: 'Asia/Kuala_Lumpur',
      status: ScheduledPostStatus.SCHEDULED,
      channel: { id: 'channel-a', name: 'Facebook' },
      brand: { id: 'brand-a', name: 'Brand' },
      campaign: null,
      history: null,
      attempts: [],
    });

    await expect(
      auth.run('user-a', () =>
        service.updatePost('post-a', {
          scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
    ).rejects.toThrow('future scheduledAt');

    expect(prisma.scheduledPost.update).not.toHaveBeenCalled();
  });

  it('allows a historical DRAFT timestamp after workspace validation', async () => {
    const { prisma, auth, service } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-a' });
    allowFacebookPost(prisma);
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
