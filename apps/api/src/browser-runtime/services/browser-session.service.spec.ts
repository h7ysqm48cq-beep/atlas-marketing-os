jest.mock(
  '../../database/prisma.service',
  () => ({
    PrismaService:
      class PrismaService {},
  }),
);

jest.mock(
  '../../automation/browser-runtime-bridge.service',
  () => ({
    BrowserRuntimeBridgeService:
      class BrowserRuntimeBridgeService {},
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
  '../events/browser-runtime-event-bus.service',
  () => ({
    BrowserRuntimeEventBus:
      class BrowserRuntimeEventBus {},
  }),
);

const {
  BrowserSessionService,
} = require(
  './browser-session.service',
);

function createHarness(input?: {
  platform?: 'FACEBOOK' | 'INSTAGRAM';
  storedLoginStatus?: string;
  storedFacebookUserId?: string | null;
  storedFacebookUserName?: string | null;
  identityLocked?: boolean;
  workerFacebookUserId?: string | null;
  workerFacebookUserName?: string | null;
  pageUrl?: string;
  pageTitle?: string;
  pageTextPreview?: string;
  pageInputs?: Array<{
    type?: string | null;
    name?: string | null;
    autocomplete?: string | null;
  }>;
}) {
  const browserAccountUpdate =
    jest.fn().mockResolvedValue({});

  const prisma = {
    browserAccount: {
      findUnique:
        jest.fn().mockResolvedValue({
          platform:
            input?.platform ??
            'FACEBOOK',
          loginStatus:
            input?.storedLoginStatus ??
            'LOGGED_IN',
          facebookUserId:
            input
              ?.storedFacebookUserId ??
            null,
          facebookUserName:
            input
              ?.storedFacebookUserName ??
            null,
          identityLocked:
            input
              ?.identityLocked ??
            true,
        }),

      update:
        browserAccountUpdate,
    },
  };

  const browserAccounts = {
    getLaunchProfile:
      jest.fn().mockResolvedValue({
        browserProfileKey:
          'browser-profile-1',
      }),
  };

  const browserRuntime = {
    request:
      jest.fn().mockResolvedValue({
        success: true,

        facebookUserId:
          input
            ?.workerFacebookUserId ??
          null,

        facebookUserName:
          input
            ?.workerFacebookUserName ??
          null,

        page: {
          title:
            input?.pageTitle ??
            'Facebook',
          url:
            input?.pageUrl ??
            'https://www.facebook.com/',
          loginLikely:
            true,
          textPreview:
            input?.pageTextPreview ??
            'Facebook home',
          inputs:
            input?.pageInputs ??
            [],
        },

        frameInspections: [],
      }),
  };

  const eventBus = {
    publish:
      jest.fn(),
  };

  const service =
    new BrowserSessionService(
      prisma,
      browserAccounts,
      browserRuntime,
      eventBus,
    );

  return {
    service,
    browserAccountUpdate,
    browserRuntime,
  };
}

describe(
  'BrowserSessionService Facebook identity persistence',
  () => {
    it(
      'requests Facebook identity capture when stored identity is incomplete',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              null,
            storedFacebookUserName:
              null,
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              'Dania Dani',
          });

        await harness.service.inspect(
          'account-1',
        );

        expect(
          harness.browserRuntime.request,
        ).toHaveBeenCalledWith(
          '/profiles/browser-profile-1/inspect',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                captureFacebookIdentity:
                  true,
              }),
          }),
        );
      },
    );

    it(
      'does not request Facebook identity capture when stored identity is complete',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              'Dania Dani',
            workerFacebookUserId:
              null,
            workerFacebookUserName:
              null,
          });

        await harness.service.inspect(
          'account-1',
        );

        const inspectCall =
          harness.browserRuntime.request
            .mock.calls.find(
              ([path]) =>
                String(path).endsWith(
                  '/inspect',
                ),
            );

        expect(
          inspectCall,
        ).toBeDefined();

        expect(
          inspectCall?.[1],
        ).not.toHaveProperty(
          'body',
        );
      },
    );
    it(
      'persists Worker Facebook identity',
      async () => {
        const harness =
          createHarness({
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              'Dania Dani',
          });

        await harness.service.inspect(
          'account-1',
        );

        expect(
          harness.browserAccountUpdate,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'account-1',
            },
            data:
              expect.objectContaining({
                facebookUserId:
                  '1234567890',
                facebookUserName:
                  'Dania Dani',
              }),
          }),
        );
      },
    );

    it(
      'does not clear stored identity when Worker identity is absent',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              'Dania Dani',
            workerFacebookUserId:
              null,
            workerFacebookUserName:
              null,
          });

        await harness.service.inspect(
          'account-1',
        );

        const call =
          harness
            .browserAccountUpdate
            .mock.calls.at(-1)?.[0];

        expect(call).toBeDefined();

        expect(
          call.data,
        ).not.toHaveProperty(
          'facebookUserId',
        );

        expect(
          call.data,
        ).not.toHaveProperty(
          'facebookUserName',
        );
      },
    );

    it(
      'fails closed on locked Facebook user id mismatch',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '111111',
            storedFacebookUserName:
              'Original User',
            identityLocked:
              true,
            workerFacebookUserId:
              '222222',
            workerFacebookUserName:
              'Different User',
          });

        await expect(
          harness.service.inspect(
            'account-1',
          ),
        ).rejects.toThrow(
          /facebook identity mismatch/i,
        );

        expect(
          harness.browserAccountUpdate,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'account-1',
            },
            data:
              expect.objectContaining({
                identityError:
                  expect.stringMatching(
                    /identity mismatch/i,
                  ),
              }),
          }),
        );

        for (
          const [call]
          of harness
            .browserAccountUpdate
            .mock.calls
        ) {
          expect(
            call.data?.facebookUserId,
          ).not.toBe('222222');
        }
      },
    );
  },
);

describe(
  'BrowserSessionService invalid Facebook profile name recovery',
  () => {
    it(
      'recaptures Facebook identity when stored name is generic Facebook chrome text',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              'Facebook',
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              null,
          });

        await harness.service.inspect(
          'account-1',
        );

        expect(
          harness.browserRuntime.request,
        ).toHaveBeenCalledWith(
          '/profiles/browser-profile-1/inspect',
          expect.objectContaining({
            method: 'POST',
            body:
              JSON.stringify({
                captureFacebookIdentity:
                  true,
              }),
          }),
        );
      },
    );

    it(
      'treats notification-prefixed Facebook title as an invalid stored name',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              '(20+) Facebook',
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              null,
          });

        await harness.service.inspect(
          'account-1',
        );

        expect(
          harness.browserRuntime.request,
        ).toHaveBeenCalledWith(
          '/profiles/browser-profile-1/inspect',
          expect.objectContaining({
            body:
              JSON.stringify({
                captureFacebookIdentity:
                  true,
              }),
          }),
        );
      },
    );

    it(
      'clears stale generic Facebook name after the same c_user is confirmed',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              'Facebook',
            identityLocked:
              true,
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              null,
          });

        await harness.service.inspect(
          'account-1',
        );

        const call =
          harness
            .browserAccountUpdate
            .mock.calls.at(-1)?.[0];

        expect(call).toBeDefined();

        expect(
          call.data.facebookUserId,
        ).toBe(
          '1234567890',
        );

        expect(
          call.data.facebookUserName,
        ).toBeNull();
      },
    );

    it(
      'does not clear a valid stored Facebook name when Worker name lookup is absent',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              'Judy Vin',
            identityLocked:
              true,
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              null,
          });

        await harness.service.inspect(
          'account-1',
        );

        const call =
          harness
            .browserAccountUpdate
            .mock.calls.at(-1)?.[0];

        expect(call).toBeDefined();

        expect(
          call.data,
        ).not.toHaveProperty(
          'facebookUserName',
        );
      },
    );

    it(
      'never accepts generic Worker Facebook title as a real name',
      async () => {
        const harness =
          createHarness({
            storedFacebookUserId:
              '1234567890',
            storedFacebookUserName:
              null,
            workerFacebookUserId:
              '1234567890',
            workerFacebookUserName:
              '(20+) Facebook',
          });

        await harness.service.inspect(
          'account-1',
        );

        const call =
          harness
            .browserAccountUpdate
            .mock.calls.at(-1)?.[0];

        expect(call).toBeDefined();

        expect(
          call.data,
        ).not.toHaveProperty(
          'facebookUserName',
        );
      },
    );
  },
);

describe(
  'BrowserSessionService Instagram login reconciliation',
  () => {
    it(
      'marks an authenticated Instagram profile as LOGGED_IN with active cookies',
      async () => {
        const harness =
          createHarness({
            platform:
              'INSTAGRAM',
            storedLoginStatus:
              'PENDING',
            pageTitle:
              'Instagram',
            pageUrl:
              'https://www.instagram.com/',
            pageTextPreview:
              'empowermindsmuse View insights Boost post Messages',
            pageInputs: [],
          });

        const result =
          await harness.service.inspect(
            'account-1',
          );

        expect(result).toMatchObject({
          loginStatus:
            'LOGGED_IN',
          loginLikely:
            true,
          loginRequired:
            false,
        });

        const call =
          harness
            .browserAccountUpdate
            .mock.calls.at(-1)?.[0];

        expect(call).toBeDefined();
        expect(call.data).toEqual(
          expect.objectContaining({
            loginStatus:
              'LOGGED_IN',
            cookieStatus:
              'ACTIVE',
            lastLoginError:
              null,
          }),
        );

        const inspectCall =
          harness.browserRuntime.request
            .mock.calls.find(
              ([path]) =>
                String(path).endsWith(
                  '/inspect',
                ),
            );

        expect(
          inspectCall?.[1],
        ).not.toHaveProperty(
          'body',
        );
      },
    );

    it(
      'marks the Instagram login page as LOGIN_REQUIRED',
      async () => {
        const harness =
          createHarness({
            platform:
              'INSTAGRAM',
            storedLoginStatus:
              'PENDING',
            pageTitle:
              'Login • Instagram',
            pageUrl:
              'https://www.instagram.com/accounts/login/',
            pageTextPreview:
              'Phone number, username, or email Password Log in Forgot password?',
            pageInputs: [
              {
                type: 'text',
                name: 'username',
                autocomplete:
                  'username',
              },
              {
                type: 'password',
                name: 'password',
              },
            ],
          });

        const result =
          await harness.service.inspect(
            'account-1',
          );

        expect(result).toMatchObject({
          loginStatus:
            'LOGIN_REQUIRED',
          loginLikely:
            false,
          loginRequired:
            true,
        });

        const call =
          harness
            .browserAccountUpdate
            .mock.calls.at(-1)?.[0];

        expect(call.data).toEqual(
          expect.objectContaining({
            loginStatus:
              'LOGIN_REQUIRED',
            cookieStatus:
              'PROFILE_READY',
            lastLoginError:
              'Instagram login is required.',
          }),
        );
      },
    );

    it(
      'reopens a stopped Instagram profile on Instagram instead of Facebook',
      async () => {
        const harness =
          createHarness({
            platform:
              'INSTAGRAM',
            storedLoginStatus:
              'PENDING',
            pageTitle:
              'Instagram',
            pageUrl:
              'https://www.instagram.com/',
            pageTextPreview:
              'empowermindsmuse View insights Boost post Messages',
          });

        let firstInspect = true;
        harness.browserRuntime.request
          .mockImplementation(
            async (path: string, options: any) => {
              if (
                path.endsWith(
                  '/inspect',
                ) &&
                firstInspect
              ) {
                firstInspect =
                  false;
                const error: any =
                  new Error(
                    'Browser profile is not running.',
                  );
                error.getResponse =
                  () => ({
                    message:
                      'Browser profile is not running.',
                    workerStatus:
                      404,
                  });
                throw error;
              }

              if (
                path ===
                '/profiles/open'
              ) {
                return {
                  opened: true,
                };
              }

              return {
                success: true,
                page: {
                  title:
                    'Instagram',
                  url:
                    'https://www.instagram.com/',
                  textPreview:
                    'empowermindsmuse View insights Boost post Messages',
                  inputs: [],
                },
                frameInspections:
                  [],
              };
            },
          );

        await harness.service.inspect(
          'account-1',
        );

        expect(
          harness.browserRuntime.request,
        ).toHaveBeenCalledWith(
          '/profiles/open',
          expect.objectContaining({
            body:
              expect.stringContaining(
                'https://www.instagram.com/',
              ),
          }),
        );
      },
    );
  },
);
