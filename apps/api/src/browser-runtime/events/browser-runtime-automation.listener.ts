import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  PrismaService,
} from '../../database/prisma.service';
import {
  BrowserAccountService,
} from '../services/browser-account.service';
import {
  BrowserSessionService,
} from '../services/browser-session.service';
import {
  BrowserRuntimeEventBus,
} from './browser-runtime-event-bus.service';

@Injectable()
export class BrowserRuntimeAutomationListener
implements
  OnModuleInit,
  OnModuleDestroy {
  private readonly logger =
    new Logger(
      BrowserRuntimeAutomationListener.name,
    );

  private unsubscribeLoginVerified:
    (() => void) | null =
    null;

  constructor(
    private readonly prisma:
      PrismaService,
    private readonly eventBus:
      BrowserRuntimeEventBus,
    private readonly browserSessions:
      BrowserSessionService,
    private readonly browserAccounts:
      BrowserAccountService,
  ) {}

  onModuleInit() {
    this.unsubscribeLoginVerified =
      this.eventBus.subscribe(
        'LOGIN_VERIFIED',
        async (event) => {
          await this.handleLoginVerified(
            event.accountId,
            event.browserProfileKey,
          );
        },
      );
  }

  onModuleDestroy() {
    this.unsubscribeLoginVerified?.();
  }

  private async handleLoginVerified(
    accountId: string,
    browserProfileKey: string,
  ) {
    this.logger.log(
      [
        'Automatic onboarding started.',
        `Account: ${accountId}.`,
      ].join(' '),
    );

    try {
      const discovery =
        await this.browserSessions
          .discoverFacebookPages(
            accountId,
          );

      const pages =
        Array.isArray(
          discovery.pages,
        )
          ? discovery.pages
          : [];

      this.eventBus.publish(
        'PAGES_DISCOVERED',
        {
          accountId,
          browserProfileKey,
          pages,
          discoveredAt:
            new Date()
              .toISOString(),
        },
      );

      if (!pages.length) {
        this.logger.warn(
          [
            'No Facebook Pages discovered.',
            `Account: ${accountId}.`,
          ].join(' '),
        );

        return;
      }

      const account =
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
        account?.brandId?.trim();

      if (!brandId) {
        this.logger.log(
          [
            `${pages.length} Page(s) discovered.`,
            'Automatic sync paused because',
            'the Browser Account has no Brand.',
          ].join(' '),
        );

        return;
      }

      const syncResult =
        await this.browserAccounts
          .syncFacebookPages(
            accountId,
            {
              brandId,
              pages,
            },
          );

      this.eventBus.publish(
        'PAGES_SYNCED',
        {
          accountId,
          brandId,
          created:
            syncResult.created,
          reused:
            syncResult.reused,
          linked:
            syncResult.linked,
          syncedAt:
            new Date()
              .toISOString(),
        },
      );

      this.logger.log(
        [
          'Automatic onboarding completed.',
          `Created: ${syncResult.created}.`,
          `Reused: ${syncResult.reused}.`,
          `Linked: ${syncResult.linked}.`,
        ].join(' '),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Automatic onboarding failed.';

      this.eventBus.publish(
        'AUTOMATION_FAILED',
        {
          accountId,
          step:
            'DISCOVER_AND_SYNC_PAGES',
          message,
          failedAt:
            new Date()
              .toISOString(),
        },
      );

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
