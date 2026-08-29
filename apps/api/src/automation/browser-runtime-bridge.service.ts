import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserAccountService } from './browser-account.service';
import { RuntimeProfileService } from './runtime-profile.service';

type WorkerResponse = {
  message?: string;
  running?: boolean;
  status?: string;
  [key: string]: unknown;
};

type WorkerInspection = WorkerResponse & {
  page?: {
    url?: string;
    textPreview?: string;
    inputs?: Array<{
      type?: string | null;
      name?: string | null;
      autocomplete?: string | null;
      visible?: boolean;
    }>;
  };
  frameInspections?: Array<{
    inputs?: Array<{
      type?: string | null;
      name?: string | null;
      autocomplete?: string | null;
      visible?: boolean;
    }>;
  }>;
};

type FacebookLoginPreflight = {
  ready: boolean;
  loginRequired: boolean;
  message: string;
  browserAccountId: string | null;
  browserProfileKey: string;
};

type BrowserLaunchProfile = Awaited<
  ReturnType<
    RuntimeProfileService[
      'getBrowserLaunchProfile'
    ]
  >
>;

const BROWSER_WORKER_REQUEST_TIMEOUT_MS = 45_000;
const FACEBOOK_PUBLISH_REQUEST_TIMEOUT_MS = 180_000;

@Injectable()
export class BrowserRuntimeBridgeService {
  private readonly logger =
    new Logger(
      BrowserRuntimeBridgeService.name,
    );

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
    private readonly browserAccounts:
      BrowserAccountService,
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
      imageUrl?: string | null;
      imageUrls?: string[] | null;
      targetUrl?: string | null;
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
      imageUrl?: string | null;
      imageUrls?: string[] | null;
    },
  ) {
    const [
      profile,
      target,
    ] =
      await Promise.all([
        this.ensureProfile(
          channelId,
          {
            headless: false,
            startUrl:
              'https://www.facebook.com/',
          },
        ),

        this.runtimeProfiles
          .getFacebookPublishingTarget(
            channelId,
          ),
      ]);

    return this.withLoginStateSync(
      profile,
      () =>
        this.prepareFacebookPost(
          profile.browserProfileKey,
          {
            ...input,
            targetUrl:
              target.targetUrl,
          },
        ),
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

    return this.withLoginStateSync(
      profile,
      () =>
        this.request(
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
          true,
          FACEBOOK_PUBLISH_REQUEST_TIMEOUT_MS,
        ),
    );
  }

  async prepareInstagramPostForChannel(
    channelId: string,
    input: {
      caption: string;
      imagePath?: string | null;
      imageUrl?: string | null;
      imagePaths?: string[];
      imageUrls?: string[];
    },
  ) {
    const profile = await this.ensureProfile(channelId, {
      headless: false,
      startUrl: 'https://www.instagram.com/',
    });

    return this.request(
      `/profiles/${encodeURIComponent(profile.browserProfileKey)}/instagram/prepare-post`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  async publishInstagramPost(channelId: string, confirmation: string) {
    if (confirmation !== 'PUBLISH') {
      throw new BadRequestException('Explicit confirmation "PUBLISH" is required.');
    }

    const profile = await this.ensureProfile(channelId, {
      headless: false,
      startUrl: 'https://www.instagram.com/',
    });

    return this.request(
      `/profiles/${encodeURIComponent(profile.browserProfileKey)}/instagram/publish-post`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      },
      true,
      90_000,
    );
  }

  async discardInstagramPost(channelId: string) {
    const profile = await this.ensureProfile(channelId, {
      headless: false,
      startUrl: 'https://www.instagram.com/',
    });

    return this.request(
      `/profiles/${encodeURIComponent(profile.browserProfileKey)}/instagram/discard-post`,
      { method: 'POST' },
    );
  }

  async testInstagramSession(channelId: string) {
    const profile = await this.ensureProfile(channelId, {
      headless: false,
      startUrl: 'https://www.instagram.com/',
    });
    const inspection = await this.request(
      `/profiles/${encodeURIComponent(profile.browserProfileKey)}/inspect`,
      { method: 'POST' },
    ) as WorkerInspection;
    const page = inspection.page ?? {};
    const url = String(page.url ?? '').toLowerCase();
    const text = String(page.textPreview ?? '').toLowerCase();
    const inputs = Array.isArray(page.inputs) ? page.inputs : [];
    const hasLoginInput = inputs.some((input) =>
      /username|password/i.test(String(input.name ?? '')) ||
      String(input.type ?? '').toLowerCase() === 'password',
    );
    if (
      url.includes('/accounts/login') ||
      hasLoginInput ||
      (text.includes('log in') && text.includes('sign up'))
    ) {
      throw new BadGatewayException('Instagram login is required.');
    }
    return {
      connected: true,
      browserProfileKey: profile.browserProfileKey,
      message: 'Instagram Browser Runtime session is ready on Railway.',
    };
  }

  async preflightInstagramLoginForChannel(channelId: string) {
    const result = await this.testInstagramSession(channelId);
    return {
      ready: true,
      loginRequired: false,
      message: result.message,
      browserProfileKey: result.browserProfileKey,
    };
  }

  /**
   * Inspect the live persistent browser before the publisher claims a post.
   * Persisted login/cookie status can become stale between scheduler runs.
   */
  async preflightFacebookLoginForChannel(
    channelId: string,
  ): Promise<FacebookLoginPreflight> {
    const profile =
      await this.ensureProfile(
        channelId,
        {
          headless: false,
          startUrl:
            'https://www.facebook.com/',
        },
      );

    const inspection =
      await this.request(
        `/profiles/${encodeURIComponent(
          profile.browserProfileKey,
        )}/inspect`,
        {
          method: 'POST',
        },
      ) as WorkerInspection;

    const state =
      this.classifyFacebookLoginInspection(
        inspection,
      );

    if (
      state.loginRequired &&
      profile.browserAccountId
    ) {
      await this.browserAccounts
        .markLoginRequired(
          profile.browserAccountId,
          state.message,
        );
    }

    if (
      state.ready &&
      profile.browserAccountId
    ) {
      await this.browserAccounts
        .markLoginVerified(
          profile.browserAccountId,
          state.message,
        );
    }

    return {
      ...state,
      browserAccountId:
        profile.browserAccountId ??
        null,
      browserProfileKey:
        profile.browserProfileKey,
    };
  }

  private classifyFacebookLoginInspection(
    inspection: WorkerInspection,
  ): Pick<
    FacebookLoginPreflight,
    'ready' | 'loginRequired' | 'message'
  > {
    const page = inspection.page ?? {};
    const currentUrl =
      page.url?.trim() ?? '';
    const normalizedUrl =
      currentUrl.toLowerCase();
    const textPreview =
      page.textPreview
        ?.trim()
        .toLowerCase() ?? '';
    const frameInputs =
      Array.isArray(
        inspection.frameInspections,
      )
        ? inspection.frameInspections
            .flatMap(
              (frame) =>
                Array.isArray(
                  frame.inputs,
                )
                  ? frame.inputs
                  : [],
            )
        : [];
    const allInputs = [
      ...(Array.isArray(page.inputs)
        ? page.inputs
        : []),
      ...frameInputs,
    ];

    const hasPasswordInput =
      allInputs.some(
        (input) =>
          input.visible !== false &&
          String(
            input.type ?? '',
          ).toLowerCase() ===
          'password',
      );
    const hasEmailInput =
      allInputs.some(
        (input) => {
          if (input.visible === false) {
            return false;
          }

          const name = String(
            input.name ?? '',
          ).toLowerCase();
          const autocomplete = String(
            input.autocomplete ?? '',
          ).toLowerCase();

          return (
            name === 'email' ||
            name.includes('email') ||
            autocomplete.includes(
              'username',
            )
          );
        },
      );
    const hasLoginText = [
      'log in to facebook',
      'forgotten password',
      'create new account',
      'email address or mobile number',
    ].some((value) =>
      textPreview.includes(value),
    );
    const loginPageByUrl =
      normalizedUrl.includes(
        'facebook.com/login',
      );
    const loginRequired =
      loginPageByUrl ||
      hasPasswordInput ||
      (hasEmailInput && hasLoginText);

    if (loginRequired) {
      return {
        ready: false,
        loginRequired: true,
        message:
          'Facebook login is required in the linked Cloud Browser.',
      };
    }

    const onFacebook =
      normalizedUrl.includes(
        'facebook.com',
      );

    if (!onFacebook) {
      return {
        ready: false,
        loginRequired: false,
        message:
          'Facebook Cloud Browser login could not be verified.',
      };
    }

    return {
      ready: true,
      loginRequired: false,
      message:
        'Facebook Cloud Browser login is ready.',
    };
  }

  private async withLoginStateSync<T>(
    profile: BrowserLaunchProfile,
    operation: () => Promise<T>,
  ) {
    try {
      return await operation();
    } catch (error) {
      if (
        profile.browserAccountId &&
        this.isLoginRequiredError(
          error,
        )
      ) {
        await this.browserAccounts
          .markLoginRequired(
            profile.browserAccountId,
            this.getWorkerErrorMessage(
              error,
            ),
          )
          .catch(
            (syncError) => {
              this.logger.warn(
                [
                  'Unable to synchronize Browser Account login state.',
                  `Account: ${profile.browserAccountId}.`,
                  syncError instanceof Error
                    ? syncError.message
                    : String(
                        syncError,
                      ),
                ].join(' '),
              );
            },
          );
      }

      throw error;
    }
  }

  private isLoginRequiredError(
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

    if (
      typeof response ===
      'object' &&
      response !== null
    ) {
      const workerResponse =
        (
          response as {
            workerResponse?: {
              loginRequired?: unknown;
            };
          }
        ).workerResponse;

      if (
        workerResponse
          ?.loginRequired ===
        true
      ) {
        return true;
      }
    }

    return this
      .getWorkerErrorMessage(
        error,
      )
      .toLowerCase()
      .includes(
        'facebook login is required',
      );
  }

  private getWorkerErrorMessage(
    error: unknown,
  ) {
    if (
      error instanceof
      BadGatewayException
    ) {
      const response =
        error.getResponse();

      if (
        typeof response ===
        'object' &&
        response !== null &&
        typeof (
          response as {
            message?: unknown;
          }
        ).message ===
          'string'
      ) {
        return (
          response as {
            message: string;
          }
        ).message;
      }
    }

    return error instanceof Error
      ? error.message
      : 'Facebook login is required.';
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

  private normalizePrepareInput(input: {
    caption: string;
    imagePath?: string | null;
    imageUrl?: string | null;
    imageUrls?: string[] | null;
    targetUrl?: string | null;
  }) {
    const caption = input.caption?.trim();

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

    const targetUrl =
      input.targetUrl?.trim() ||
      null;

    const imageUrls = Array.from(
      new Set(
        [...(input.imageUrls ?? []), input.imageUrl]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (imageUrls.length > 10) {
      throw new BadRequestException(
        'Facebook posts support at most 10 images.',
      );
    }

    for (const imageUrl of imageUrls) {
      let parsedImageUrl: URL;

      try {
        parsedImageUrl = new URL(imageUrl);
      } catch {
        throw new BadRequestException(
          'Invalid Facebook image URL.',
        );
      }

      if (
        !['http:', 'https:'].includes(
          parsedImageUrl.protocol,
        )
      ) {
        throw new BadRequestException(
          'Facebook image URL must use http or https.',
        );
      }
    }

    if (targetUrl) {
      let parsed:
        URL;

      try {
        parsed =
          new URL(
            targetUrl,
          );
      } catch {
        throw new BadRequestException(
          'Invalid Facebook Page target URL.',
        );
      }

      const hostname =
        parsed.hostname
          .toLowerCase();

      if (
        hostname !==
          'facebook.com' &&
        hostname !==
          'www.facebook.com' &&
        !hostname.endsWith(
          '.facebook.com',
        )
      ) {
        throw new BadRequestException(
          'Facebook Page target must use facebook.com.',
        );
      }
    }

    return {
      caption,

      imagePath:
        input.imagePath?.trim() ||
        null,

      imageUrl: imageUrls[0] ?? null,

      imageUrls,

      targetUrl,
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

    const defaultWorkerUrl =
      process.env.NODE_ENV ===
      'production'
        ? 'http://browser-worker.railway.internal:4010'
        : 'http://localhost:4010';

    let workerUrl =
      configuredValue ||
      defaultWorkerUrl;

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
    timeoutMs = BROWSER_WORKER_REQUEST_TIMEOUT_MS,
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

    try {
      let response: Awaited<ReturnType<typeof fetch>> | undefined = undefined;
      const method = (init.method || "GET").toUpperCase();
      const retryableNetworkRequest =
        method === "GET" || path === "/profiles/open" || path.endsWith("/prepare-post");
      const maxAttempts = retryableNetworkRequest ? 3 : 1;
      let lastError: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          response = await fetch(
            `${this.getWorkerUrl()}${path}`,
            {
              ...init,
              headers,
              signal: controller.signal,
            },
          );
          break;
        } catch (error) {
          lastError = error;
          const retryableError =
            error instanceof Error &&
            (error.message === "fetch failed" || error.name === "AbortError");
          if (!retryableNetworkRequest || !retryableError || attempt + 1 >= maxAttempts) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
        } finally {
          clearTimeout(timeout);
        }
      }

      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("fetch failed");
      }

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
