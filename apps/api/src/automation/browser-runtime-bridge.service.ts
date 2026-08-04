import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RuntimeProfileService } from './runtime-profile.service';

type WorkerResponse = {
  message?: string;
  running?: boolean;
  status?: string;
  [key: string]: unknown;
};

type BrowserLaunchProfile = Awaited<
  ReturnType<
    RuntimeProfileService[
      'getBrowserLaunchProfile'
    ]
  >
>;

@Injectable()
export class BrowserRuntimeBridgeService {
  /**
   * Prevent two simultaneous requests from opening
   * the same browser profile more than once.
   */
  private readonly profileLaunches =
    new Map<
      string,
      Promise<BrowserLaunchProfile>
    >();

  constructor(
    private readonly configService:
      ConfigService,
    private readonly runtimeProfiles:
      RuntimeProfileService,
  ) {}

  async health() {
    return this.request(
      '/health',
      {
        method: 'GET',
      },
    );
  }

  async open(
    channelId: string,
    input?: {
      headless?: boolean;
      startUrl?: string;
    },
  ) {
    const profile =
      await this.runtimeProfiles
        .getBrowserLaunchProfile(
          channelId,
        );

    return this.openProfile(
      profile,
      input,
    );
  }

  async status(
    channelId: string,
  ) {
    const profile =
      await this.runtimeProfiles
        .getBrowserLaunchProfile(
          channelId,
        );

    return this.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/status`,
      {
        method: 'GET',
      },
    );
  }

  /**
   * Browser Runtime V2:
   *
   * Return the existing browser profile when it is
   * running. If the Worker reports that the profile
   * is not running, automatically reopen it using
   * the same persistent browser profile.
   */
  async ensureProfile(
    channelId: string,
    input?: {
      headless?: boolean;
      startUrl?: string;
    },
  ): Promise<BrowserLaunchProfile> {
    const profile =
      await this.runtimeProfiles
        .getBrowserLaunchProfile(
          channelId,
        );

    const existingLaunch =
      this.profileLaunches.get(
        profile.browserProfileKey,
      );

    if (existingLaunch) {
      return existingLaunch;
    }

    const launchPromise =
      this.ensureProfileInternal(
        profile,
        input,
      );

    this.profileLaunches.set(
      profile.browserProfileKey,
      launchPromise,
    );

    try {
      return await launchPromise;
    } finally {
      this.profileLaunches.delete(
        profile.browserProfileKey,
      );
    }
  }

  /**
   * Existing low-level PREPARE method.
   *
   * This remains available for callers that already
   * know that the browser profile is running.
   */
  async prepareFacebookPost(
    browserProfileKey: string,
    input: {
      caption: string;
      imagePath?: string | null;
    },
  ) {
    const normalizedInput =
      this.normalizePrepareInput(
        input,
      );

    return this.request(
      `/profiles/${encodeURIComponent(
        browserProfileKey,
      )}/facebook/prepare-post`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(
          normalizedInput,
        ),
      },
    );
  }

  /**
   * Preferred V2 PREPARE method.
   *
   * It automatically ensures that the browser profile
   * is running before preparing the Facebook draft.
   */
  async prepareFacebookPostForChannel(
    channelId: string,
    input: {
      caption: string;
      imagePath?: string | null;
    },
  ) {
    const profile =
      await this.ensureProfile(
        channelId,
        {
          headless: false,
          startUrl:
            'https://www.facebook.com/',
        },
      );

    return this.prepareFacebookPost(
      profile.browserProfileKey,
      input,
    );
  }

  async discardFacebookPost(
    channelId: string,
  ) {
    const profile =
      await this.ensureProfile(
        channelId,
        {
          headless: false,
          startUrl:
            'https://www.facebook.com/',
        },
      );

    return this.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/facebook/discard-post`,
      {
        method: 'POST',
      },
    );
  }

  async publishFacebookPost(
    channelId: string,
    confirmation: string,
  ) {
    if (
      confirmation !==
      'PUBLISH'
    ) {
      throw new BadRequestException(
        'Explicit confirmation "PUBLISH" is required.',
      );
    }

    const profile =
      await this.ensureProfile(
        channelId,
        {
          headless: false,
          startUrl:
            'https://www.facebook.com/',
        },
      );

    return this.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/facebook/publish-post`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({
          confirmation,
        }),
      },
    );
  }

  async checkIp(
    channelId: string,
  ) {
    const profile =
      await this.ensureProfile(
        channelId,
        {
          headless: false,
        },
      );

    return this.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/check-ip`,
      {
        method: 'POST',
      },
    );
  }

  async close(
    channelId: string,
  ) {
    const profile =
      await this.runtimeProfiles
        .getBrowserLaunchProfile(
          channelId,
        );

    this.profileLaunches.delete(
      profile.browserProfileKey,
    );

    return this.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/close`,
      {
        method: 'POST',
      },
    );
  }

  private async ensureProfileInternal(
    profile: BrowserLaunchProfile,
    input?: {
      headless?: boolean;
      startUrl?: string;
    },
  ): Promise<BrowserLaunchProfile> {
    try {
      const workerStatus =
        await this.request(
          `/profiles/${encodeURIComponent(
            profile.browserProfileKey,
          )}/status`,
          {
            method: 'GET',
          },
        );

      if (
        this.workerStatusIndicatesStopped(
          workerStatus,
        )
      ) {
        await this.openProfile(
          profile,
          input,
        );
      }

      return profile;
    } catch (error) {
      if (
        !this.isProfileNotRunningError(
          error,
        )
      ) {
        throw error;
      }

      await this.openProfile(
        profile,
        input,
      );

      return profile;
    }
  }

  private async openProfile(
    profile: BrowserLaunchProfile,
    input?: {
      headless?: boolean;
      startUrl?: string;
    },
  ) {
    const startUrl =
      input?.startUrl?.trim() ||
      'https://www.facebook.com/';

    this.validateStartUrl(
      startUrl,
    );

    return this.request(
      '/profiles/open',
      {
        method: 'POST',
        body: JSON.stringify({
          ...profile,
          headless:
            input?.headless ??
            false,
          startUrl,
        }),
      },
    );
  }

  private normalizePrepareInput(
    input: {
      caption: string;
      imagePath?: string | null;
    },
  ) {
    const caption =
      input.caption?.trim();

    if (!caption) {
      throw new BadRequestException(
        'Caption is required.',
      );
    }

    if (
      caption.length >
      10000
    ) {
      throw new BadRequestException(
        'Caption is too long.',
      );
    }

    return {
      caption,
      imagePath:
        input.imagePath?.trim() ||
        null,
    };
  }

  private workerStatusIndicatesStopped(
    body: WorkerResponse,
  ) {
    if (
      body.running === false
    ) {
      return true;
    }

    const status =
      typeof body.status ===
      'string'
        ? body.status
            .trim()
            .toUpperCase()
        : '';

    return [
      'STOPPED',
      'CLOSED',
      'NOT_RUNNING',
      'NOT FOUND',
    ].includes(
      status,
    );
  }

  private isProfileNotRunningError(
    error: unknown,
  ) {
    if (
      !(
        error instanceof
        BadGatewayException
      )
    ) {
      return false;
    }

    const response =
      error.getResponse();

    const serialized =
      typeof response ===
      'string'
        ? response
        : JSON.stringify(
            response,
          );

    const normalized =
      serialized.toLowerCase();

    return (
      normalized.includes(
        'browser profile is not running',
      ) ||
      normalized.includes(
        'profile is not running',
      ) ||
      normalized.includes(
        'profile was not found',
      )
    );
  }

  private getWorkerUrl() {
    const configuredValue =
      this.configService
        .get<string>(
          'BROWSER_WORKER_URL',
        )
        ?.trim();

    let workerUrl =
      configuredValue ||
      'http://localhost:4010';

    if (
      !workerUrl.startsWith(
        'http://',
      ) &&
      !workerUrl.startsWith(
        'https://',
      )
    ) {
      workerUrl =
        `https://${workerUrl}`;
    }

    workerUrl =
      workerUrl.replace(
        /\/+$/,
        '',
      );

    try {
      const parsed =
        new URL(
          workerUrl,
        );

      if (
        ![
          'http:',
          'https:',
        ].includes(
          parsed.protocol,
        )
      ) {
        throw new Error(
          'Unsupported protocol.',
        );
      }

      return parsed
        .toString()
        .replace(
          /\/+$/,
          '',
        );
    } catch {
      throw new ServiceUnavailableException(
        'Browser Worker URL is invalid.',
      );
    }
  }

  private getWorkerToken() {
    return this.configService
      .get<string>(
        'BROWSER_WORKER_TOKEN',
      )
      ?.trim();
  }

  async request(
    path: string,
    init: RequestInit,
    authenticated = true,
  ) {
    const headers =
      new Headers(
        init.headers,
      );

    headers.set(
      'Accept',
      'application/json',
    );

    if (init.body) {
      headers.set(
        'Content-Type',
        'application/json',
      );
    }

    if (authenticated) {
      const token =
        this.getWorkerToken();

      if (!token) {
        throw new ServiceUnavailableException(
          'Browser Worker token is not configured.',
        );
      }

      headers.set(
        'Authorization',
        `Bearer ${token}`,
      );
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        45000,
      );

    try {
      const response =
        await fetch(
          `${this.getWorkerUrl()}${path}`,
          {
            ...init,
            headers,
            signal:
              controller.signal,
          },
        );

      const raw =
        await response.text();

      let body:
        WorkerResponse = {};

      if (raw.trim()) {
        try {
          body =
            JSON.parse(
              raw,
            ) as WorkerResponse;
        } catch {
          body = {
            message: raw,
          };
        }
      }

      if (!response.ok) {
        throw new BadGatewayException({
          message:
            body.message ||
            'Browser Worker request failed.',
          workerStatus:
            response.status,
          workerResponse:
            body,
        });
      }

      return body;
    } catch (error) {
      if (
        error instanceof
        BadGatewayException
      ) {
        throw error;
      }

      if (
        error instanceof Error &&
        error.name ===
          'AbortError'
      ) {
        throw new ServiceUnavailableException(
          'Browser Worker request timed out.',
        );
      }

      throw new ServiceUnavailableException(
        error instanceof Error
          ? `Browser Worker unavailable: ${error.message}`
          : 'Browser Worker unavailable.',
      );
    } finally {
      clearTimeout(
        timeout,
      );
    }
  }

  private validateStartUrl(
    value: string,
  ) {
    let url: URL;

    try {
      url =
        new URL(
          value,
        );
    } catch {
      throw new BadRequestException(
        'Invalid browser start URL.',
      );
    }

    if (
      ![
        'http:',
        'https:',
      ].includes(
        url.protocol,
      )
    ) {
      throw new BadRequestException(
        'Browser start URL must use HTTP or HTTPS.',
      );
    }
  }
}
