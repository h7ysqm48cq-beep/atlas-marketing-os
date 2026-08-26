import { PrismaService } from '../../database/prisma.service';
import { BrowserRuntimeBridgeService } from '../../automation/browser-runtime-bridge.service';
import { BrowserRuntimeEventBus } from '../events/browser-runtime-event-bus.service';
import { BrowserAccountService } from './browser-account.service';
import { BrowserSessionService } from './browser-session.service';

jest.mock('../../automation/browser-runtime-bridge.service', () => ({
  BrowserRuntimeBridgeService: class BrowserRuntimeBridgeService {},
}));

describe('BrowserSessionService Facebook login state', () => {
  it('ignores hidden login inputs on a live logged-in Facebook page', async () => {
    const prisma = {
      browserAccount: {
        findUnique: jest.fn().mockResolvedValue({
          loginStatus: 'LOGIN_REQUIRED',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const browserAccounts = {
      getLaunchProfile: jest.fn().mockResolvedValue({
        browserProfileKey: 'profile-1',
      }),
    };
    const browserRuntime = {
      request: jest.fn().mockResolvedValue({
        success: true,
        page: {
          url: 'https://www.facebook.com/pages/?category=your_pages',
          textPreview:
            'Pages that Dania Dani manages MGM满贯门SportsNews 专治你没瓜看 M Story Shiba MGM House',
          inputs: [],
        },
        frameInspections: [
          {
            inputs: [
              {
                type: 'password',
                visible: false,
              },
            ],
          },
        ],
      }),
    };
    const eventBus = {
      publish: jest.fn(),
    };
    const service = new BrowserSessionService(
      prisma as unknown as PrismaService,
      browserAccounts as unknown as BrowserAccountService,
      browserRuntime as unknown as BrowserRuntimeBridgeService,
      eventBus as unknown as BrowserRuntimeEventBus,
    );

    await expect(
      service.inspect('account-1'),
    ).resolves.toMatchObject({
      loginStatus: 'LOGGED_IN',
      loginRequired: false,
      loginLikely: true,
    });

    expect(
      prisma.browserAccount.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loginStatus: 'LOGGED_IN',
          cookieStatus: 'ACTIVE',
          lastLoginError: null,
        }),
      }),
    );
  });
});
