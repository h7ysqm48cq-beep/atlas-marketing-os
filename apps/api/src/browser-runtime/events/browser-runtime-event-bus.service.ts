import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  EventEmitter,
} from 'node:events';

export type BrowserRuntimeEventMap = {
  LOGIN_VERIFIED: {
    accountId: string;
    browserProfileKey: string;
    loginStatus: 'LOGGED_IN';
    verifiedAt: string;
  };

  PAGES_DISCOVERED: {
    accountId: string;
    browserProfileKey: string;
    pages: Array<{
      pageId?: string | null;
      name?: string;
      url?: string | null;
      imageUrl?: string | null;
      username?: string | null;
    }>;
    discoveredAt: string;
  };

  PAGES_SYNCED: {
    accountId: string;
    brandId: string;
    created: number;
    reused: number;
    linked: number;
    syncedAt: string;
  };

  AUTOMATION_FAILED: {
    accountId: string;
    step: string;
    message: string;
    failedAt: string;
  };
};

export type BrowserRuntimeEventName =
  keyof BrowserRuntimeEventMap;

@Injectable()
export class BrowserRuntimeEventBus {
  private readonly logger =
    new Logger(
      BrowserRuntimeEventBus.name,
    );

  private readonly emitter =
    new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(
      100,
    );
  }

  publish<
    Name extends BrowserRuntimeEventName,
  >(
    name: Name,
    payload:
      BrowserRuntimeEventMap[Name],
  ) {
    this.logger.log(
      [
        `Event: ${name}.`,
        `Account: ${payload.accountId}.`,
      ].join(' '),
    );

    setImmediate(() => {
      this.emitter.emit(
        name,
        payload,
      );
    });
  }

  subscribe<
    Name extends BrowserRuntimeEventName,
  >(
    name: Name,
    listener: (
      payload:
        BrowserRuntimeEventMap[Name],
    ) => void | Promise<void>,
  ) {
    const wrapped = (
      payload:
        BrowserRuntimeEventMap[Name],
    ) => {
      Promise.resolve(
        listener(payload),
      ).catch((error) => {
        this.logger.error(
          [
            `Event listener failed.`,
            `Event: ${name}.`,
            error instanceof Error
              ? error.message
              : String(error),
          ].join(' '),
          error instanceof Error
            ? error.stack
            : undefined,
        );
      });
    };

    this.emitter.on(
      name,
      wrapped,
    );

    return () => {
      this.emitter.off(
        name,
        wrapped,
      );
    };
  }
}
