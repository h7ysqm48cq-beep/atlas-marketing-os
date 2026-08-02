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
  [key: string]: unknown;
};

@Injectable()
export class BrowserRuntimeBridgeService {
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
      false,
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

  async checkIp(
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

    return this.request(
      `/profiles/${encodeURIComponent(
        profile.browserProfileKey,
      )}/close`,
      {
        method: 'POST',
      },
    );
  }

  private getWorkerUrl() {
    const value =
      this.configService.get<string>(
        'BROWSER_WORKER_URL',
      );

    return (
      value?.trim().replace(
        /\/+$/,
        '',
      ) ||
      'http://localhost:4010'
    );
  }

  private getWorkerToken() {
    return this.configService
      .get<string>(
        'BROWSER_WORKER_TOKEN',
      )
      ?.trim();
  }

  private async request(
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
