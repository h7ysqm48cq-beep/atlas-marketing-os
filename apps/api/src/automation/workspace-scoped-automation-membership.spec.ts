import { AuthContextService } from '../auth/auth-context.service';
import { WorkspaceScopeService } from '../auth/workspace-scope.service';

jest.mock('./publisher.service', () => ({
  PublisherService: class PublisherService {},
}));

jest.mock('./runtime-profile.service', () => ({
  RuntimeProfileService: class RuntimeProfileService {},
}));

import { WorkspaceScopedAutomationService } from './workspace-scoped-automation.service';

describe('WorkspaceScopedAutomationService membership resolution', () => {
  it('uses the default workspace membership instead of ownerUserId', async () => {
    const prisma = {
      workspace: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-shared',
          userId: 'user-a',
          workspaceId: 'workspace-shared',
          isDefault: true,
          workspace: { id: 'workspace-shared', slug: 'mgmbetmyr' },
        }),
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      socialChannel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'channel-shared',
            workspaceId: 'workspace-shared',
            accessTokenEncrypted: null,
          },
          {
            id: 'channel-personal',
            workspaceId: 'workspace-personal',
            accessTokenEncrypted: null,
          },
        ]),
      },
    } as any;

    const auth = new AuthContextService();
    const workspaceScope = new WorkspaceScopeService(prisma, auth);
    const service = new WorkspaceScopedAutomationService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      workspaceScope as any,
    );

    const channels = await auth.run('user-a', () => service.listChannels());

    expect(channels.map((channel) => channel.id)).toEqual(['channel-shared']);
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', isDefault: true },
      }),
    );
    expect(prisma.workspace.findUnique).not.toHaveBeenCalledWith({
      where: { ownerUserId: 'user-a' },
      select: { id: true },
    });
  });

  it('uses the mgmbetmyr system workspace when there is no auth context', async () => {
    const prisma = {
      workspace: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({
          id: 'workspace-system',
          slug: 'mgmbetmyr',
        }),
      },
      workspaceMember: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      socialChannel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'channel-system',
            workspaceId: 'workspace-system',
            accessTokenEncrypted: null,
          },
          {
            id: 'channel-other',
            workspaceId: 'workspace-other',
            accessTokenEncrypted: null,
          },
        ]),
      },
    } as any;

    const auth = new AuthContextService();
    const workspaceScope = new WorkspaceScopeService(prisma, auth);
    const service = new WorkspaceScopedAutomationService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      workspaceScope as any,
    );

    const channels = await service.listChannels();

    expect(channels.map((channel) => channel.id)).toEqual(['channel-system']);
    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: { slug: 'mgmbetmyr' },
      update: {},
      create: { name: 'MGMBETMYR', slug: 'mgmbetmyr' },
    });
  });
});
