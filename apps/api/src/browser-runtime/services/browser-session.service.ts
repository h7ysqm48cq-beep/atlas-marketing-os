import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
} from '../../database/prisma.service';
import {
  BrowserRuntimeBridgeService,
} from '../../automation/browser-runtime-bridge.service';
import {
  BrowserAccountService,
} from './browser-account.service';
import {
  BrowserRuntimeEventBus,
} from '../events/browser-runtime-event-bus.service';

type OpenBrowserInput = {
  headless?: boolean;
  startUrl?: string;
};

type WorkerInspection = {
  facebookUserId?: string | null;
  facebookUserName?: string | null;

  page?: {
    title?: string;
    url?: string;
    loginLikely?: boolean;
    textPreview?: string;
    inputs?: Array<{
      type?: string | null;
      name?: string | null;
      autocomplete?: string | null;
    }>;
  };
  frameInspections?: Array<{
    frameUrl?: string;
    frameName?: string;
    textPreview?: string;
    inputs?: Array<{
      type?: string | null;
      name?: string | null;
      autocomplete?: string | null;
      visible?: boolean;
    }>;
  }>;
  success?: boolean;
  [key: string]: unknown;
};

@Injectable()
export class BrowserSessionService {
  constructor(
    private readonly prisma:
      PrismaService,
    private readonly browserAccounts:
      BrowserAccountService,
    private readonly browserRuntime:
      BrowserRuntimeBridgeService,
    private readonly eventBus:
      BrowserRuntimeEventBus,
  ) {}

  async open(
    accountId: string,
    input: OpenBrowserInput = {},
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const startUrl =
      input.startUrl?.trim() ||
      'https://www.facebook.com/';

    this.validateStartUrl(
      startUrl,
    );

    const result =
      await this.browserRuntime.request(
        '/profiles/open',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...profile,
            headless:
              input.headless ??
              false,
            startUrl,
          }),
        },
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        /*
         * Browser runtime state and Facebook
         * identity state are independent.
         *
         * Opening Chromium must never overwrite
         * LOGGED_IN / LOGIN_REQUIRED / 2FA /
         * CHECKPOINT or the stored cookie state.
         */
        lastHeartbeatAt:
          new Date(),
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      result,
    };
  }

  async status(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const result =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/status`,
        {
          method: 'GET',
        },
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        /*
         * status() reports Chromium runtime only.
         * Do not mutate Facebook login identity.
         */
        lastHeartbeatAt:
          new Date(),
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      ...result,
    };
  }

  async inspect(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const inspectPath =
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/inspect`;

    const previousAccount =
      await this.prisma.browserAccount.findUnique({
        where: {
          id: accountId,
        },
        select: {
          loginStatus: true,
          facebookUserId: true,
          facebookUserName: true,
          identityLocked: true,
        },
      });

    const storedFacebookUserId =
      previousAccount
        ?.facebookUserId
        ?.trim() ||
      '';

    const storedFacebookUserName =
      previousAccount
        ?.facebookUserName
        ?.trim() ||
      '';

    const captureFacebookIdentity =
      !storedFacebookUserId ||
      !storedFacebookUserName;

    const inspectRequest =
      captureFacebookIdentity
        ? {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              captureFacebookIdentity:
                true,
            }),
          }
        : {
            method: 'POST',
          };

    let result:
      WorkerInspection;

    try {
      result =
        (
          await this.browserRuntime.request(
            inspectPath,
            inspectRequest,
          )
        ) as WorkerInspection;
    } catch (error) {
      if (
        !this.isProfileNotRunningError(
          error,
        )
      ) {
        throw error;
      }

      await this.browserRuntime.request(
        '/profiles/open',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...profile,
            headless: false,
            startUrl:
              'https://www.facebook.com/',
          }),
        },
      );

      result =
        (
          await this.browserRuntime.request(
            inspectPath,
            inspectRequest,
          )
        ) as WorkerInspection;
    }

    const page =
      result.page || {};

    const currentUrl =
      page.url?.trim() ||
      '';

    const textPreview =
      page.textPreview
        ?.trim()
        .toLowerCase() ||
      '';

    const frameInspections =
      Array.isArray(
        result.frameInspections,
      )
        ? result.frameInspections
        : [];

    const pageInputs =
      Array.isArray(
        page.inputs,
      )
        ? page.inputs
        : [];

    const frameInputs =
      frameInspections.flatMap(
        (frame: any) =>
          Array.isArray(
            frame?.inputs,
          )
            ? frame.inputs
            : [],
      );

    const allInputs = [
      ...pageInputs,
      ...frameInputs,
    ];

    const hasEmailInput =
      allInputs.some(
        (input: any) => {
          const name =
            String(
              input?.name || '',
            ).toLowerCase();

          const type =
            String(
              input?.type || '',
            ).toLowerCase();

          const autocomplete =
            String(
              input?.autocomplete ||
              '',
            ).toLowerCase();

          return (
            name === 'email' ||
            autocomplete.includes(
              'username',
            ) ||
            (
              type === 'text' &&
              name.includes(
                'email',
              )
            )
          );
        },
      );

    const hasPasswordInput =
      allInputs.some(
        (input: any) =>
          String(
            input?.type || '',
          ).toLowerCase() ===
          'password',
      );

    const hasLoginText =
      [
        'log in to facebook',
        'forgotten password',
        'create new account',
        'email address or mobile number',
      ].some(
        (value) =>
          textPreview.includes(
            value,
          ),
      );

    const loginPageByUrl =
      this.isFacebookLoginPage(
        currentUrl,
      );

    const twoFactorRequired =
      currentUrl
        .toLowerCase()
        .includes(
          'two_step_verification',
        ) ||
      textPreview.includes(
        'authentication code',
      ) ||
      textPreview.includes(
        'two-factor authentication',
      ) ||
      textPreview.includes(
        'enter the code',
      );

    const checkpointRequired =
      currentUrl
        .toLowerCase()
        .includes(
          '/checkpoint',
        ) ||
      textPreview.includes(
        'security check',
      ) ||
      textPreview.includes(
        'confirm your identity',
      );

    const loginRequired =
      !twoFactorRequired &&
      !checkpointRequired &&
      (
        loginPageByUrl ||
        hasPasswordInput ||
        (
          hasEmailInput &&
          hasLoginText
        )
      );

    const loginLikely =
      !loginRequired &&
      !twoFactorRequired &&
      !checkpointRequired &&
      currentUrl
        .toLowerCase()
        .includes(
          'facebook.com',
        );

    const loginStatus =
      twoFactorRequired
        ? 'TWO_FACTOR_REQUIRED'
        : checkpointRequired
          ? 'CHECKPOINT_REQUIRED'
          : loginRequired
            ? 'LOGIN_REQUIRED'
            : loginLikely
              ? 'LOGGED_IN'
              : 'UNKNOWN';

    const cookieStatus =
      loginLikely
        ? 'ACTIVE'
        : loginRequired
          ? 'PROFILE_READY'
          : twoFactorRequired ||
              checkpointRequired
            ? 'PENDING_VERIFICATION'
            : 'UNKNOWN';

    const workerFacebookUserId =
      typeof result.facebookUserId ===
      'string'
        ? result.facebookUserId.trim()
        : '';

    const workerFacebookUserName =
      typeof result.facebookUserName ===
      'string'
        ? result.facebookUserName.trim()
        : '';

    const facebookIdentityMismatch =
      Boolean(
        workerFacebookUserId &&
        previousAccount
          ?.identityLocked &&
        storedFacebookUserId &&
        storedFacebookUserId !==
          workerFacebookUserId,
      );

    if (facebookIdentityMismatch) {
      const identityError =
        `Facebook identity mismatch: expected ${storedFacebookUserId}, detected ${workerFacebookUserId}.`;

      await this.prisma.browserAccount.update({
        where: {
          id: accountId,
        },
        data: {
          identityError,
          lastLoginError:
            identityError,
          lastVerifiedAt:
            new Date(),
          lastHeartbeatAt:
            new Date(),
        },
      });

      throw new BadRequestException(
        identityError,
      );
    }

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        loginStatus,
        cookieStatus,

        ...(workerFacebookUserId
          ? {
              facebookUserId:
                workerFacebookUserId,
              identityError:
                null,
            }
          : {}),

        ...(workerFacebookUserName
          ? {
              facebookUserName:
                workerFacebookUserName,
            }
          : {}),

        lastLoginAt:
          loginLikely
            ? new Date()
            : undefined,
        lastVerifiedAt:
          new Date(),
        lastHeartbeatAt:
          new Date(),
        lastLoginError:
          loginRequired
            ? 'Facebook login is required.'
            : twoFactorRequired
              ? 'Facebook two-factor verification is required.'
              : checkpointRequired
                ? 'Facebook security checkpoint requires attention.'
                : null,
      },
    });

    if (
      loginStatus ===
        'LOGGED_IN' &&
      previousAccount
        ?.loginStatus !==
        'LOGGED_IN'
    ) {
      this.eventBus.publish(
        'LOGIN_VERIFIED',
        {
          accountId,
          browserProfileKey:
            profile.browserProfileKey,
          loginStatus:
            'LOGGED_IN',
          verifiedAt:
            new Date()
              .toISOString(),
        },
      );
    }

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      loginStatus,
      loginLikely,
      loginRequired,
      twoFactorRequired,
      checkpointRequired,
      detection: {
        loginPageByUrl,
        hasEmailInput,
        hasPasswordInput,
        hasLoginText,
      },
      page,
      result,
    };
  }

  async discoverFacebookPages(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const status =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/status`,
        {
          method: 'GET',
        },
      );

    if (
      status.running !== true
    ) {
      await this.browserRuntime.request(
        '/profiles/open',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...profile,
            headless: false,
            startUrl:
              'https://www.facebook.com/',
          }),
        },
      );
    }

    const result =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/facebook/discover-pages`,
        {
          method: 'POST',
        },
      );

    const discoveredPages =
      Array.isArray(
        result.pages,
      )
        ? result.pages
        : [];

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        lastVerifiedAt:
          new Date(),
        lastHeartbeatAt:
          new Date(),
        lastLoginError:
          null,
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      count:
        discoveredPages.length,
      pages:
        discoveredPages,
      currentUrl:
        result.currentUrl ??
        null,
      discoveredAt:
        result.discoveredAt ??
        new Date().toISOString(),
    };
  }


  async verifyIp(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const checkedAt =
      new Date();

    try {
      const result =
        await this.browserRuntime.request(
          `/profiles/${encodeURIComponent(
            profile.browserProfileKey,
          )}/ip/verify`,
          {
            method: 'POST',
          },
        ) as {
          success?: boolean;
          running?: boolean;
          ip?: string;
          proxyType?: string;
          checkedAt?: string;
          message?: string;
        };

      const currentIp =
        result.ip?.trim();

      if (!currentIp) {
        throw new Error(
          result.message ||
          'Worker returned no public IP.',
        );
      }

      const account =
        await this.prisma.browserAccount
          .findUnique({
            where: {
              id:
                accountId,
            },
            select: {
              expectedIp:
                true,
              lastKnownIp:
                true,
            },
          });

      if (!account) {
        throw new NotFoundException(
          'Browser account was not found.',
        );
      }

      const expectedIp =
        account.expectedIp ||
        currentIp;

      const ipStatus =
        expectedIp ===
        currentIp
          ? 'MATCH'
          : 'CHANGED';

      await this.prisma.browserAccount
        .update({
          where: {
            id:
              accountId,
          },
          data: {
            expectedIp,
            lastKnownIp:
              currentIp,
            lastIpCheckedAt:
              checkedAt,
            ipStatus,
            lastHeartbeatAt:
              checkedAt,
          },
        });

      return {
        accountId,
        browserProfileKey:
          profile.browserProfileKey,
        success:
          true,
        running:
          result.running ??
          true,
        currentIp,
        expectedIp,
        previousIp:
          account.lastKnownIp,
        ipStatus,
        changed:
          ipStatus ===
          'CHANGED',
        proxyType:
          result.proxyType ??
          profile.proxyType,
        checkedAt:
          result.checkedAt ??
          checkedAt.toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to verify browser IP.';

      await this.prisma.browserAccount
        .update({
          where: {
            id:
              accountId,
          },
          data: {
            lastIpCheckedAt:
              checkedAt,
            ipStatus:
              'FAILED',
            lastHeartbeatAt:
              checkedAt,
            lastLoginError:
              message.slice(
                0,
                1000,
              ),
          },
        })
        .catch(
          () =>
            undefined,
        );

      throw error;
    }
  }

  async close(
    accountId: string,
  ) {
    const profile =
      await this.browserAccounts
        .getLaunchProfile(
          accountId,
        );

    const result =
      await this.browserRuntime.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/close`,
        {
          method: 'POST',
        },
      );

    await this.prisma.browserAccount.update({
      where: {
        id: accountId,
      },
      data: {
        /*
         * Closing Chromium preserves the
         * Facebook identity stored inside the
         * persistent browser profile.
         */
        lastHeartbeatAt:
          new Date(),
      },
    });

    return {
      accountId,
      browserProfileKey:
        profile.browserProfileKey,
      result,
    };
  }

  private validateStartUrl(
    value: string,
  ) {
    let parsed: URL;

    try {
      parsed =
        new URL(value);
    } catch {
      throw new BadRequestException(
        'Start URL is invalid.',
      );
    }

    if (
      ![
        'http:',
        'https:',
      ].includes(
        parsed.protocol,
      )
    ) {
      throw new BadRequestException(
        'Start URL must use HTTP or HTTPS.',
      );
    }
  }

  private isProfileNotRunningError(
    error: unknown,
  ) {
    const response =
      error &&
      typeof error === 'object' &&
      'getResponse' in error &&
      typeof (
        error as {
          getResponse?: unknown;
        }
      ).getResponse ===
        'function'
        ? (
            error as {
              getResponse:
                () => unknown;
            }
          ).getResponse()
        : error;

    const normalized =
      (
        typeof response ===
        'string'
          ? response
          : JSON.stringify(
              response,
            )
      ).toLowerCase();

    return (
      normalized.includes(
        'browser profile is not running',
      ) ||
      normalized.includes(
        'profile is not running',
      ) ||
      normalized.includes(
        'profile was not found',
      ) ||
      normalized.includes(
        '"workerstatus":404',
      )
    );
  }

  private isFacebookLoginPage(
    url: string,
  ) {
    const normalized =
      url.toLowerCase();

    return (
      normalized.includes(
        '/login',
      ) ||
      normalized.includes(
        '/checkpoint',
      ) ||
      normalized.includes(
        '/two_step_verification',
      ) ||
      normalized.includes(
        '/recover',
      )
    );
  }
}
