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
  storedFacebookUserId?: string | null;
  storedFacebookUserName?: string | null;
  identityLocked?: boolean;
  workerFacebookUserId?: string | null;
  workerFacebookUserName?: string | null;
}) {
  const browserAccountUpdate =
    jest.fn().mockResolvedValue({});

  const prisma = {
    browserAccount: {
      findUnique:
        jest.fn().mockResolvedValue({
          loginStatus:
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
            'Facebook',
          url:
            'https://www.facebook.com/',
          loginLikely:
            true,
          textPreview:
            'Facebook home',
          inputs: [],
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
