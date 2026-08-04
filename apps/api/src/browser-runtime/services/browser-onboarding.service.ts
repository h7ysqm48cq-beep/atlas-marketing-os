import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  BrowserAccountEventStatus,
} from '../../generated/prisma/client';
import {
  PrismaService,
} from '../../database/prisma.service';
import {
  BrowserAccountService,
} from './browser-account.service';
import {
  BrowserAutomationPolicyService,
} from './browser-automation-policy.service';
import {
  BrowserSessionService,
} from './browser-session.service';
import {
  BrowserTimelineService,
} from './browser-timeline.service';

@Injectable()
export class BrowserOnboardingService {
  private readonly logger =
    new Logger(
      BrowserOnboardingService.name,
    );

  private readonly activeRuns =
    new Map<
      string,
      Promise<Record<string, unknown>>
    >();

  constructor(
    private readonly prisma:
      PrismaService,
    private readonly accounts:
      BrowserAccountService,
    private readonly sessions:
      BrowserSessionService,
    private readonly policies:
      BrowserAutomationPolicyService,
    private readonly timeline:
      BrowserTimelineService,
  ) {}

  async run(
    accountId: string,
    input?: {
      verifyLogin?: boolean;
      forceDiscover?: boolean;
      forceSync?: boolean;
      closeAfterComplete?: boolean;
    },
  ) {
    const existing =
      this.activeRuns.get(
        accountId,
      );

    if (existing) {
      return existing;
    }

    const operation =
      this.runInternal(
        accountId,
        input,
      );

    this.activeRuns.set(
      accountId,
      operation,
    );

    try {
      return await operation;
    } finally {
      this.activeRuns.delete(
        accountId,
      );
    }
  }

  private async runInternal(
    accountId: string,
    input?: {
      verifyLogin?: boolean;
      forceDiscover?: boolean;
      forceSync?: boolean;
      closeAfterComplete?: boolean;
    },
  ) {
    const account =
      await this.prisma
        .browserAccount
        .findUnique({
          where: {
            id: accountId,
          },
        });

    if (!account) {
      throw new BadRequestException(
        'Browser account was not found.',
      );
    }

    const policy =
      await this.policies
        .getOrCreate(
          accountId,
        );

    await this.timeline.record({
      accountId,
      eventType:
        'ONBOARDING_STARTED',
      status:
        BrowserAccountEventStatus.INFO,
      title:
        'Automatic onboarding started',
    });

    try {
      const shouldVerify =
        input?.verifyLogin ??
        policy.autoVerifyLogin;

      let loginStatus =
        account.loginStatus;

      if (shouldVerify) {
        const inspection =
          await this.sessions.inspect(
            accountId,
          );

        loginStatus =
          String(
            inspection.loginStatus ||
            'UNKNOWN',
          );
      }

      if (
        loginStatus !==
        'LOGGED_IN'
      ) {
        await this.timeline.record({
          accountId,
          eventType:
            'LOGIN_ATTENTION_REQUIRED',
          status:
            BrowserAccountEventStatus.WARNING,
          title:
            'Facebook login requires attention',
          message:
            `Current status: ${loginStatus}.`,
        });

        return {
          success: false,
          completed: false,
          accountId,
          loginStatus,
          requiresAttention: true,
          step:
            'LOGIN',
        };
      }

      const shouldDiscover =
        input?.forceDiscover ===
          true ||
        policy.autoDiscoverPages;

      let pages:
        Array<Record<string, unknown>> =
        [];

      if (shouldDiscover) {
        const discovery =
          await this.sessions
            .discoverFacebookPages(
              accountId,
            );

        pages =
          Array.isArray(
            discovery.pages,
          )
            ? discovery.pages as
                Array<
                  Record<
                    string,
                    unknown
                  >
                >
            : [];

        await this.timeline.record({
          accountId,
          eventType:
            'PAGES_DISCOVERED',
          status:
            BrowserAccountEventStatus.SUCCESS,
          title:
            `${pages.length} Facebook Page(s) discovered`,
          metadata: {
            count:
              pages.length,
            pages,
          },
        });
      }

      const shouldSync =
        input?.forceSync ===
          true ||
        policy.autoSyncPages;

      let syncResult:
        Record<string, unknown> |
        null =
        null;

      if (
        shouldSync &&
        pages.length
      ) {
        const refreshedAccount =
          await this.prisma
            .browserAccount
            .findUnique({
              where: {
                id: accountId,
              },
              select: {
                brandId: true,
              },
            });

        const brandId =
          refreshedAccount
            ?.brandId
            ?.trim();

        if (!brandId) {
          await this.timeline.record({
            accountId,
            eventType:
              'SYNC_WAITING_FOR_BRAND',
            status:
              BrowserAccountEventStatus.WARNING,
            title:
              'Page sync is waiting for a Brand',
            message:
              'Select a Brand for this Browser Account, then run onboarding again.',
            metadata: {
              pageCount:
                pages.length,
            },
          });

          return {
            success: true,
            completed: false,
            accountId,
            loginStatus,
            pagesDiscovered:
              pages.length,
            requiresAttention:
              true,
            step:
              'SELECT_BRAND',
          };
        }

        syncResult =
          await this.accounts
            .syncFacebookPages(
              accountId,
              {
                brandId,
                pages:
                  pages as Array<{
                    pageId?:
                      string | null;
                    name?: string;
                    url?:
                      string | null;
                    imageUrl?:
                      string | null;
                    username?:
                      string | null;
                  }>,
              },
            );

        await this.timeline.record({
          accountId,
          eventType:
            'PAGES_SYNCED',
          status:
            BrowserAccountEventStatus.SUCCESS,
          title:
            'Facebook Pages synced',
          metadata:
            syncResult,
        });
      }

      const shouldClose =
        input
          ?.closeAfterComplete ??
        (
          policy.autoCloseBrowser &&
          !policy
            .keepBrowserOpenAfterLogin
        );

      if (shouldClose) {
        await this.sessions.close(
          accountId,
        );

        await this.timeline.record({
          accountId,
          eventType:
            'BROWSER_CLOSED',
          status:
            BrowserAccountEventStatus.SUCCESS,
          title:
            'Browser closed automatically',
        });
      }

      await this.timeline.record({
        accountId,
        eventType:
          'ONBOARDING_COMPLETED',
        status:
          BrowserAccountEventStatus.SUCCESS,
        title:
          'Automatic onboarding completed',
        metadata: {
          pagesDiscovered:
            pages.length,
          syncResult,
          browserClosed:
            shouldClose,
        },
      });

      return {
        success: true,
        completed: true,
        accountId,
        loginStatus,
        pagesDiscovered:
          pages.length,
        syncResult,
        browserClosed:
          shouldClose,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Automatic onboarding failed.';

      this.logger.error(
        [
          'Browser onboarding failed.',
          `Account: ${accountId}.`,
          message,
        ].join(' '),
        error instanceof Error
          ? error.stack
          : undefined,
      );

      await this.timeline
        .record({
          accountId,
          eventType:
            'ONBOARDING_FAILED',
          status:
            BrowserAccountEventStatus.FAILED,
          title:
            'Automatic onboarding failed',
          message,
        })
        .catch(() => undefined);

      await this.prisma
        .browserAccount
        .update({
          where: {
            id: accountId,
          },
          data: {
            lastLoginError:
              message,
          },
        })
        .catch(() => undefined);

      throw error;
    }
  }
}
