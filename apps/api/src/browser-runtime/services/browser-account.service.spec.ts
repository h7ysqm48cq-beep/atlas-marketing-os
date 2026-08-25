import { BrowserAccountEventStatus } from '../../generated/prisma/client';
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
});
