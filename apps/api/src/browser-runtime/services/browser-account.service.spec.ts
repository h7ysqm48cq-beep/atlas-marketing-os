import {
  BrowserAccountEventStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SocialTokenCryptoService } from '../../common/social-token-crypto.service';
import { BrowserAccountService } from './browser-account.service';

describe('BrowserAccountService login state', () => {
  type BrowserAccountUpdateInput = {
    where: {
      id: string;
    };
    data: {
      loginStatus: string;
      cookieStatus: string;
      lastVerifiedAt: Date;
      lastHeartbeatAt: Date;
      lastLoginError: string;
    };
  };

  type BrowserAccountEventInput = {
    data: {
      browserAccountId: string;
      eventType: string;
      status: BrowserAccountEventStatus;
      title: string;
      message: string;
      metadata: {
        source: string;
        observedAt: string;
      };
    };
  };

  const createService = (account: {
    id: string;
    loginStatus: string;
    lastLoginError: string | null;
  }) => {
    const transaction = {
      browserAccount: {
        update: jest
          .fn<Promise<void>, [BrowserAccountUpdateInput]>()
          .mockResolvedValue(undefined),
      },
      browserAccountEvent: {
        create: jest
          .fn<Promise<void>, [BrowserAccountEventInput]>()
          .mockResolvedValue(undefined),
      },
    };

    const prisma = {
      browserAccount: {
        findUnique: jest.fn().mockResolvedValue(account),
      },
      $transaction: jest.fn(
        async (callback: (input: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };

    return {
      service: new BrowserAccountService(
        prisma as unknown as PrismaService,
        {} as SocialTokenCryptoService,
      ),
      transaction,
    };
  };

  it('persists a live Facebook login failure and creates a timeline warning', async () => {
    const { service, transaction } = createService({
      id: 'account-1',
      loginStatus: 'LOGGED_IN',
      lastLoginError: null,
    });

    await service.markLoginRequired('account-1', 'Facebook login is required.');

    const updateInput = transaction.browserAccount.update.mock.calls[0]?.[0];

    expect(updateInput?.where.id).toBe('account-1');
    expect(updateInput?.data.loginStatus).toBe('LOGIN_REQUIRED');
    expect(updateInput?.data.cookieStatus).toBe('PROFILE_READY');
    expect(updateInput?.data.lastVerifiedAt).toBeInstanceOf(Date);
    expect(updateInput?.data.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(updateInput?.data.lastLoginError).toBe(
      'Facebook login is required.',
    );

    const eventInput =
      transaction.browserAccountEvent.create.mock.calls[0]?.[0];

    expect(eventInput?.data.browserAccountId).toBe('account-1');
    expect(eventInput?.data.eventType).toBe('LOGIN_ATTENTION_REQUIRED');
    expect(eventInput?.data.status).toBe(BrowserAccountEventStatus.WARNING);
    expect(eventInput?.data.message).toBe('Facebook login is required.');
  });

  it('refreshes the observed state without duplicating an unchanged warning', async () => {
    const { service, transaction } = createService({
      id: 'account-1',
      loginStatus: 'LOGIN_REQUIRED',
      lastLoginError: 'Facebook login is required.',
    });

    await service.markLoginRequired('account-1', 'Facebook login is required.');

    expect(transaction.browserAccount.update).toHaveBeenCalledTimes(1);

    expect(transaction.browserAccountEvent.create).not.toHaveBeenCalled();
  });

  it('restores a live verified Facebook login and records the recovery', async () => {
    const { service, transaction } = createService({
      id: 'account-1',
      loginStatus: 'LOGIN_REQUIRED',
      lastLoginError: 'Facebook login is required.',
    });

    await service.markLoginVerified(
      'account-1',
      'Facebook Cloud Browser login is ready.',
    );

    const updateInput =
      transaction.browserAccount.update.mock.calls[0]?.[0];

    expect(updateInput?.data.loginStatus).toBe('LOGGED_IN');
    expect(updateInput?.data.cookieStatus).toBe('ACTIVE');
    expect(updateInput?.data.lastLoginError).toBeNull();

    const eventInput =
      transaction.browserAccountEvent.create.mock.calls[0]?.[0];

    expect(eventInput?.data.eventType).toBe('LOGIN_VERIFIED');
    expect(eventInput?.data.status).toBe(BrowserAccountEventStatus.SUCCESS);
  });
});

describe('BrowserAccountService Facebook Page sync', () => {
  const createService = (
    existingChannels: Array<{
      id: string;
      name: string;
      externalId: string | null;
      username: string | null;
      accessTokenEncrypted: string | null;
    }> = [],
  ) => {
    const account = {
      id: 'account-1',
      platform: SocialPlatform.FACEBOOK,
      brandId: 'brand-1',
      workspaceId: 'workspace-1',
    };

    const fullChannels = existingChannels.map((channel) => ({
      ...channel,
      workspaceId: 'workspace-1',
      brandId: 'brand-1',
      platform: SocialPlatform.FACEBOOK,
      status: SocialChannelStatus.CONNECTED,
      publishingPreference: 'AUTOMATIC',
      tokenExpiresAt: null,
      lastConnectedAt: null,
      lastError: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    }));

    const transaction = {
      socialChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(fullChannels),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'created-channel',
            accessTokenEncrypted: null,
            ...data,
          }),
        ),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const channel = fullChannels.find((item) => item.id === where.id);

          return Promise.resolve({
            ...channel,
            ...data,
          });
        }),
      },
      browserAccountChannel: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      browserAccount: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      browserAccount: {
        findUnique: jest.fn().mockResolvedValue(account),
      },
      brand: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'brand-1',
          workspaceId: 'workspace-1',
        }),
      },
      $transaction: jest.fn(
        async (callback: (input: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };

    return {
      service: new BrowserAccountService(
        prisma as unknown as PrismaService,
        {} as SocialTokenCryptoService,
      ),
      transaction,
    };
  };

  it('rejects composer and unread anchors even when they contain numeric IDs', async () => {
    const { service, transaction } = createService();

    await expect(
      service.syncFacebookPages('account-1', {
        pages: [
          {
            pageId: '1281719171682210',
            name: 'Create Post',
            url: 'https://www.facebook.com/profile.php?id=1281719171682210&modal=composer',
          },
          {
            pageId: '1292937667230187',
            name: 'UnreadWelcome to 大马吹水总会',
            url: 'https://www.facebook.com/profile.php?id=1292937667230187',
          },
        ],
      }),
    ).rejects.toThrow('usable ID or username');

    expect(transaction.socialChannel.create).not.toHaveBeenCalled();
  });

  it('reuses one same-name channel without preferring or overwriting its API identity', async () => {
    const { service, transaction } = createService([
      {
        id: 'existing-channel',
        name: '专治你没瓜看',
        externalId: 'graph-page-id',
        username: null,
        accessTokenEncrypted: 'encrypted-api-token',
      },
    ]);

    await service.syncFacebookPages('account-1', {
      pages: [
        {
          pageId: 'browser-page-id',
          name: '专治你没瓜看',
          url: 'https://www.facebook.com/browser-page-id',
          username: 'browser-page-id',
        },
      ],
    });

    expect(transaction.socialChannel.create).not.toHaveBeenCalled();
    expect(transaction.socialChannel.update).toHaveBeenCalledWith({
      where: {
        id: 'existing-channel',
      },
      data: expect.not.objectContaining({
        externalId: expect.anything(),
        accessTokenEncrypted: expect.anything(),
      }),
    });
  });

  it('stops sync instead of creating a third channel when a same-name match is ambiguous', async () => {
    const { service, transaction } = createService([
      {
        id: 'channel-1',
        name: 'Duplicate Page',
        externalId: 'graph-id-1',
        username: null,
        accessTokenEncrypted: null,
      },
      {
        id: 'channel-2',
        name: 'Duplicate Page',
        externalId: 'graph-id-2',
        username: null,
        accessTokenEncrypted: 'encrypted-api-token',
      },
    ]);

    await expect(
      service.syncFacebookPages('account-1', {
        pages: [
          {
            pageId: 'browser-page-id',
            name: 'Duplicate Page',
            url: 'https://www.facebook.com/browser-page-id',
          },
        ],
      }),
    ).rejects.toThrow('multiple existing channels');

    expect(transaction.socialChannel.create).not.toHaveBeenCalled();
  });
});
