jest.mock(
  '../../database/prisma.service',
  () => ({
    PrismaService:
      class PrismaService {},
  }),
);

jest.mock(
  './browser-account.service',
  () => ({
    BrowserAccountService:
      class BrowserAccountService {},
  }),
);

jest.mock(
  './browser-automation-policy.service',
  () => ({
    BrowserAutomationPolicyService:
      class BrowserAutomationPolicyService {},
  }),
);

jest.mock(
  './browser-session.service',
  () => ({
    BrowserSessionService:
      class BrowserSessionService {},
  }),
);

jest.mock(
  './browser-timeline.service',
  () => ({
    BrowserTimelineService:
      class BrowserTimelineService {},
  }),
);

const {
  BrowserOnboardingService,
} = require(
  './browser-onboarding.service',
);

describe(
  'BrowserOnboardingService platform guard',
  () => {
    it(
      'skips Instagram before policy, timeline, session, or page onboarding work',
      async () => {
        const prisma = {
          browserAccount: {
            findUnique:
              jest.fn().mockResolvedValue({
                id: 'ig-account-1',
                platform:
                  'INSTAGRAM',
                loginStatus:
                  'LOGGED_IN',
              }),
          },
        };

        const accounts = {
          syncFacebookPages:
            jest.fn(),
        };

        const sessions = {
          inspect:
            jest.fn(),
          discoverFacebookPages:
            jest.fn(),
          close:
            jest.fn(),
        };

        const policies = {
          getOrCreate:
            jest.fn(),
        };

        const timeline = {
          record:
            jest.fn(),
        };

        const service =
          new BrowserOnboardingService(
            prisma as never,
            accounts as never,
            sessions as never,
            policies as never,
            timeline as never,
          );

        await expect(
          service.run(
            'ig-account-1',
            {
              verifyLogin:
                false,
            },
          ),
        ).resolves.toEqual({
          success: true,
          completed: true,
          skipped: true,
          accountId:
            'ig-account-1',
          platform:
            'INSTAGRAM',
          reason:
            'ONBOARDING_NOT_APPLICABLE_FOR_PLATFORM',
        });

        expect(
          policies.getOrCreate,
        ).not.toHaveBeenCalled();

        expect(
          timeline.record,
        ).not.toHaveBeenCalled();

        expect(
          sessions.inspect,
        ).not.toHaveBeenCalled();

        expect(
          sessions.discoverFacebookPages,
        ).not.toHaveBeenCalled();

        expect(
          accounts.syncFacebookPages,
        ).not.toHaveBeenCalled();

        expect(
          sessions.close,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'keeps Facebook onboarding on the existing path',
      async () => {
        const prisma = {
          browserAccount: {
            findUnique:
              jest.fn().mockResolvedValue({
                id: 'fb-account-1',
                platform:
                  'FACEBOOK',
                loginStatus:
                  'LOGIN_REQUIRED',
              }),
          },
        };

        const accounts = {
          syncFacebookPages:
            jest.fn(),
        };

        const sessions = {
          inspect:
            jest.fn(),
          discoverFacebookPages:
            jest.fn(),
          close:
            jest.fn(),
        };

        const policies = {
          getOrCreate:
            jest.fn().mockResolvedValue({
              autoVerifyLogin:
                false,
              autoDiscoverPages:
                false,
              autoSyncPages:
                false,
              autoCloseBrowser:
                false,
            }),
        };

        const timeline = {
          record:
            jest.fn().mockResolvedValue(
              {},
            ),
        };

        const service =
          new BrowserOnboardingService(
            prisma as never,
            accounts as never,
            sessions as never,
            policies as never,
            timeline as never,
          );

        const result =
          await service.run(
            'fb-account-1',
            {
              verifyLogin:
                false,
            },
          );

        expect(
          policies.getOrCreate,
        ).toHaveBeenCalledWith(
          'fb-account-1',
        );

        expect(
          timeline.record,
        ).toHaveBeenCalled();

        expect(result).toMatchObject({
          success: false,
          completed: false,
          loginStatus:
            'LOGIN_REQUIRED',
          requiresAttention:
            true,
          step:
            'LOGIN',
        });
      },
    );
  },
);
