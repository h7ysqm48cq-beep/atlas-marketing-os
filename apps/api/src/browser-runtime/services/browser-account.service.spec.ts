jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../generated/prisma/client', () => require('../../generated/prisma/enums'));
import { BrowserAccountService } from './browser-account.service';
import { WorkspaceScopedBrowserAccountService } from './workspace-scoped-browser-account.service';

describe('BrowserAccountService.syncFacebookPages', () => {
  it.each(['NATIVE_API', 'AUTOMATIC', 'BROWSER_RUNTIME'])(
    'preserves an existing channel publishing choice (%s) across repeated Page syncs',
    async (publishingPreference) => {
      let stored = {
        id: 'sports-channel', name: 'Sports News', platform: 'FACEBOOK',
        externalId: '123456789', username: null, status: 'CONNECTED',
        publishingPreference, accessTokenEncrypted: 'existing-encrypted-token',
      };
      const tx = {
        socialChannel: {
          findMany: jest.fn(async () => [{ ...stored }]),
          update: jest.fn(async ({ data }) => (stored = { ...stored, ...data })),
          create: jest.fn(),
        },
        browserAccountChannel: {
          findUnique: jest.fn().mockResolvedValue({ channelId: stored.id }),
          create: jest.fn(),
        },
        browserAccount: { update: jest.fn() },
      };
      const prisma = {
        browserAccount: { findUnique: jest.fn().mockResolvedValue({
          id: 'judy', platform: 'FACEBOOK', brandId: 'brand', workspaceId: 'workspace',
        }) },
        brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand', workspaceId: 'workspace' }) },
        $transaction: jest.fn(async (action) => action(tx)),
      };
      const service = new BrowserAccountService(prisma as never, {} as never);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await service.syncFacebookPages('judy', {
          pages: [{ pageId: '123456789', name: 'Sports News' }],
        });
        expect(result).toMatchObject({ success: true, reused: 1, created: 0 });
        expect(stored.publishingPreference).toBe(publishingPreference);
      }
      expect(stored.accessTokenEncrypted).toBe('existing-encrypted-token');
      expect(tx.socialChannel.create).not.toHaveBeenCalled();
    },
  );
});

describe('BrowserAccountService workspace scope', () => {
  const createService = (prisma: Record<string, any>) => {
    const workspaceScope = {
      getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
    };
    return new WorkspaceScopedBrowserAccountService(
      prisma as never,
      {
        encrypt: jest.fn((value: string) => `encrypted:${value}`),
        decrypt: jest.fn((value: string) => value),
      } as never,
      workspaceScope as never,
    );
  };

  it('lists only browser accounts from the current workspace', async () => {
    const prisma = {
      browserAccount: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    await service.list();

    expect(prisma.browserAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-a',
        },
      }),
    );
  });

  it('does not return a browser account from another workspace', async () => {
    const prisma = {
      browserAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'account-b',
          workspaceId: 'workspace-b',
          channels: [],
        }),
      },
    };
    const service = createService(prisma);

    await expect(service.getById('account-b')).rejects.toThrow(
      'Browser account was not found.',
    );

    expect(prisma.browserAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'account-b',
          workspaceId: 'workspace-a',
        },
      }),
    );
  });

  it('ignores a client supplied workspaceId when creating an account', async () => {
    const prisma = {
      browserAccount: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'account-a',
            channels: [],
            ...data,
          }),
        ),
      },
      brand: {
        findFirst: jest.fn(),
      },
    };
    const service = createService(prisma);

    await service.create({
      displayName: 'Workspace A Account',
      workspaceId: 'workspace-b',
    });

    expect(prisma.browserAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'workspace-a',
      }),
    });
  });

  it('rejects a brand that is outside the current workspace', async () => {
    const prisma = {
      browserAccount: {
        create: jest.fn(),
      },
      brand: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = createService(prisma);

    await expect(
      service.create({
        displayName: 'Workspace A Account',
        brandId: 'brand-b',
      }),
    ).rejects.toThrow('Brand was not found.');

    expect(prisma.brand.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'brand-b',
        workspaceId: 'workspace-a',
      },
      select: {
        id: true,
      },
    });
    expect(prisma.browserAccount.create).not.toHaveBeenCalled();
  });

  it('keeps the browser account in the current workspace when brandId is cleared', async () => {
    const existing = {
      id: 'account-a',
      workspaceId: 'workspace-a',
      brandId: 'brand-a',
      displayName: 'Workspace A Account',
      browserProfileName: 'Workspace A Browser',
      locale: 'en-MY',
      timezone: 'Asia/Kuala_Lumpur',
      proxyType: 'DIRECT',
      proxyHost: null,
      proxyPort: null,
      proxyCountry: null,
      proxyUsernameEncrypted: null,
      proxyPasswordEncrypted: null,
      channels: [],
    };
    const prisma = {
      browserAccount: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'account-a',
          workspaceId: 'workspace-a',
          brandId: 'brand-a',
          platform: 'FACEBOOK',
        }),
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...existing,
            ...data,
            channels: [],
          }),
        ),
      },
      brand: {
        findFirst: jest.fn(),
      },
    };
    const service = createService(prisma);

    await service.update('account-a', { brandId: null });

    expect(prisma.browserAccount.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'account-a' },
        data: expect.objectContaining({
          brandId: null,
          workspaceId: 'workspace-a',
        }),
      }),
    );
  });

  it('filters stale cross-workspace browser links from channel selection', async () => {
    const prisma = {
      socialChannel: {
        findFirst: jest.fn().mockResolvedValue({ id: 'channel-a' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'channel-a',
          name: 'Workspace A Page',
          platform: 'FACEBOOK',
          status: 'CONNECTED',
        }),
      },
      browserAccountChannel: {
        findMany: jest.fn().mockResolvedValue([
          {
            browserAccountId: 'account-b',
            isPrimary: true,
            browserAccount: {
              id: 'account-b',
              workspaceId: 'workspace-b',
              displayName: 'Workspace B Browser',
              browserProfileKey: 'profile-b',
              browserProfileName: 'Browser B',
              loginStatus: 'LOGGED_IN',
              cookieStatus: 'ACTIVE',
              proxyType: 'DIRECT',
              proxyCountry: null,
              lastKnownIp: null,
              lastHeartbeatAt: new Date(),
              lastLoginError: null,
            },
          },
          {
            browserAccountId: 'account-a',
            isPrimary: false,
            browserAccount: {
              id: 'account-a',
              workspaceId: 'workspace-a',
              displayName: 'Workspace A Browser',
              browserProfileKey: 'profile-a',
              browserProfileName: 'Browser A',
              loginStatus: 'LOGGED_IN',
              cookieStatus: 'ACTIVE',
              proxyType: 'DIRECT',
              proxyCountry: null,
              lastKnownIp: null,
              lastHeartbeatAt: new Date(),
              lastLoginError: null,
            },
          },
        ]),
      },
      browserAccount: {
        findMany: jest.fn().mockResolvedValue([{ id: 'account-a' }]),
      },
    };
    const service = createService(prisma);

    const result = await service.selectForChannel('channel-a');

    expect(result.candidates.map((candidate: any) => candidate.id)).toEqual([
      'account-a',
    ]);
    expect(result.selected).toMatchObject({ id: 'account-a' });
    expect(prisma.browserAccount.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['account-b', 'account-a'] },
        workspaceId: 'workspace-a',
      },
      select: { id: true },
    });
  });
});