import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { SocialTokenCryptoService } from '../common/social-token-crypto.service';
import { RuntimeProfileService } from './runtime-profile.service';

type FacebookOAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

type FacebookPageAccount = {
  id: string;
  name: string;
  username?: string;
  access_token?: string;
  category?: string;
  fan_count?: number;
};

type FacebookAccountsResponse = {
  data?: FacebookPageAccount[];
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

type OAuthStatePayload = {
  brandId: string;
  nonce: string;
  expiresAt: number;
};

@Injectable()
export class FacebookOAuthService {
  constructor(
    private readonly configService:
      ConfigService,
    private readonly prisma:
      PrismaService,
    private readonly socialTokenCrypto:
      SocialTokenCryptoService,
    private readonly runtimeProfiles:
      RuntimeProfileService,
  ) {}

  async createAuthorizationUrl(
    brandId: string,
  ) {
    const cleanBrandId =
      brandId?.trim();

    if (!cleanBrandId) {
      throw new BadRequestException(
        'brandId is required.',
      );
    }

    const brand =
      await this.prisma.brand.findUnique({
        where: {
          id: cleanBrandId,
        },
        select: {
          id: true,
          name: true,
        },
      });

    if (!brand) {
      throw new BadRequestException(
        'Brand not found.',
      );
    }

    const state =
      this.createState({
        brandId: brand.id,
        nonce:
          randomBytes(18)
            .toString('base64url'),
        expiresAt:
          Date.now() +
          10 * 60 * 1000,
      });

    const url =
      new URL(
        'https://www.facebook.com/v25.0/dialog/oauth',
      );

    url.searchParams.set(
      'client_id',
      this.getAppId(),
    );

    url.searchParams.set(
      'redirect_uri',
      this.getRedirectUri(),
    );

    url.searchParams.set(
      'state',
      state,
    );

    url.searchParams.set(
      'response_type',
      'code',
    );

    url.searchParams.set(
      'scope',
      [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
      ].join(','),
    );

    return {
      authorizationUrl:
        url.toString(),
      brand: {
        id: brand.id,
        name: brand.name,
      },
    };
  }

  async handleCallback(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }) {
    if (input.error) {
      throw new BadRequestException(
        input.errorDescription ||
          input.error,
      );
    }

    const code =
      input.code?.trim();

    const state =
      input.state?.trim();

    if (!code || !state) {
      throw new BadRequestException(
        'Facebook OAuth callback is missing code or state.',
      );
    }

    const statePayload =
      this.verifyState(state);

    const brand =
      await this.prisma.brand.findUnique({
        where: {
          id: statePayload.brandId,
        },
        select: {
          id: true,
          name: true,
          workspaceId: true,
        },
      });

    if (!brand) {
      throw new BadRequestException(
        'The selected brand no longer exists.',
      );
    }

    const shortToken =
      await this.exchangeCodeForToken(
        code,
      );

    const longToken =
      await this.exchangeLongLivedToken(
        shortToken,
      );

    const pages =
      await this.fetchAllPages(
        longToken.accessToken,
      );

    if (!pages.length) {
      throw new BadRequestException(
        'No manageable Facebook Pages were returned for this account.',
      );
    }

    const fallbackExpiry =
      longToken.expiresIn
        ? new Date(
            Date.now() +
              longToken.expiresIn *
                1000,
          )
        : null;

    const imported: Array<{
      id: string;
      pageId: string;
      name: string;
      username: string | null;
      followers: number | null;
      category: string | null;
    }> = [];

    for (const page of pages) {
      const pageToken =
        page.access_token?.trim();

      if (!page.id?.trim() ||
          !pageToken) {
        continue;
      }

      const channel =
        await this.prisma.socialChannel.upsert({
          where: {
            brandId_platform_externalId: {
              brandId: brand.id,
              platform:
                SocialPlatform.FACEBOOK,
              externalId: page.id,
            },
          },
          create: {
            workspaceId:
              brand.workspaceId,
            brandId:
              brand.id,
            platform:
              SocialPlatform.FACEBOOK,
            name:
              page.name ||
              `Facebook Page ${page.id}`,
            externalId:
              page.id,
            username:
              page.username ?? null,
            accessTokenEncrypted:
              this.socialTokenCrypto.encrypt(
                pageToken,
              ),
            tokenExpiresAt:
              fallbackExpiry,
            status:
              SocialChannelStatus.CONNECTED,
            lastConnectedAt:
              new Date(),
            lastError:
              null,
          },
          update: {
            name:
              page.name ||
              `Facebook Page ${page.id}`,
            username:
              page.username ?? null,
            accessTokenEncrypted:
              this.socialTokenCrypto.encrypt(
                pageToken,
              ),
            tokenExpiresAt:
              fallbackExpiry,
            status:
              SocialChannelStatus.CONNECTED,
            lastConnectedAt:
              new Date(),
            lastError:
              null,
          },
        });

      await this.runtimeProfiles
        .ensureForChannel(
          channel.id,
          channel.name,
        );

      imported.push({
        id: channel.id,
        pageId: page.id,
        name: channel.name,
        username:
          channel.username,
        followers:
          page.fan_count ?? null,
        category:
          page.category ?? null,
      });
    }

    if (!imported.length) {
      throw new BadRequestException(
        'Facebook returned Pages, but none contained a usable Page access token.',
      );
    }

    return {
      success: true,
      brand: {
        id: brand.id,
        name: brand.name,
      },
      imported,
    };
  }

  buildSuccessRedirect(input: {
    importedCount: number;
    brandId: string;
  }) {
    const url =
      new URL(
        this.getSuccessUrl(),
      );

    url.searchParams.set(
      'facebook',
      'connected',
    );

    url.searchParams.set(
      'imported',
      String(
        input.importedCount,
      ),
    );

    url.searchParams.set(
      'brandId',
      input.brandId,
    );

    return url.toString();
  }

  buildErrorRedirect(
    message: string,
  ) {
    const url =
      new URL(
        this.getSuccessUrl(),
      );

    url.searchParams.set(
      'facebook',
      'error',
    );

    url.searchParams.set(
      'message',
      message.slice(0, 300),
    );

    return url.toString();
  }

  private async exchangeCodeForToken(
    code: string,
  ) {
    const url =
      new URL(
        `${this.getGraphBaseUrl()}/oauth/access_token`,
      );

    url.searchParams.set(
      'client_id',
      this.getAppId(),
    );

    url.searchParams.set(
      'client_secret',
      this.getAppSecret(),
    );

    url.searchParams.set(
      'redirect_uri',
      this.getRedirectUri(),
    );

    url.searchParams.set(
      'code',
      code,
    );

    const response =
      await fetch(url);

    const body =
      (await response.json()) as
        FacebookOAuthTokenResponse;

    this.throwFacebookError(
      response.ok,
      body.error,
    );

    if (!body.access_token) {
      throw new BadRequestException(
        'Facebook did not return an access token.',
      );
    }

    return body.access_token;
  }

  private async exchangeLongLivedToken(
    shortToken: string,
  ) {
    const url =
      new URL(
        `${this.getGraphBaseUrl()}/oauth/access_token`,
      );

    url.searchParams.set(
      'grant_type',
      'fb_exchange_token',
    );

    url.searchParams.set(
      'client_id',
      this.getAppId(),
    );

    url.searchParams.set(
      'client_secret',
      this.getAppSecret(),
    );

    url.searchParams.set(
      'fb_exchange_token',
      shortToken,
    );

    const response =
      await fetch(url);

    const body =
      (await response.json()) as
        FacebookOAuthTokenResponse;

    this.throwFacebookError(
      response.ok,
      body.error,
    );

    if (!body.access_token) {
      throw new BadRequestException(
        'Unable to obtain a long-lived Facebook access token.',
      );
    }

    return {
      accessToken:
        body.access_token,
      expiresIn:
        body.expires_in,
    };
  }

  private async fetchAllPages(
    userAccessToken: string,
  ) {
    const pages:
      FacebookPageAccount[] = [];

    let nextUrl:
      string | null =
        `${this.getGraphBaseUrl()}/me/accounts`;

    while (nextUrl) {
      const url =
        new URL(nextUrl);

      if (!url.searchParams.has(
        'fields',
      )) {
        url.searchParams.set(
          'fields',
          [
            'id',
            'name',
            'username',
            'access_token',
            'category',
            'fan_count',
          ].join(','),
        );
      }

      if (!url.searchParams.has(
        'limit',
      )) {
        url.searchParams.set(
          'limit',
          '100',
        );
      }

      if (!url.searchParams.has(
        'access_token',
      )) {
        url.searchParams.set(
          'access_token',
          userAccessToken,
        );
      }

      const response =
        await fetch(url);

      const body =
        (await response.json()) as
          FacebookAccountsResponse;

      this.throwFacebookError(
        response.ok,
        body.error,
      );

      pages.push(
        ...(body.data ?? []),
      );

      nextUrl =
        body.paging?.next ??
        null;
    }

    return pages;
  }

  private createState(
    payload: OAuthStatePayload,
  ) {
    const encodedPayload =
      Buffer.from(
        JSON.stringify(payload),
        'utf8',
      ).toString('base64url');

    const signature =
      createHmac(
        'sha256',
        this.getAppSecret(),
      )
        .update(encodedPayload)
        .digest('base64url');

    return [
      encodedPayload,
      signature,
    ].join('.');
  }

  private verifyState(
    state: string,
  ): OAuthStatePayload {
    const [
      encodedPayload,
      suppliedSignature,
    ] = state.split('.');

    if (
      !encodedPayload ||
      !suppliedSignature
    ) {
      throw new BadRequestException(
        'Invalid Facebook OAuth state.',
      );
    }

    const expectedSignature =
      createHmac(
        'sha256',
        this.getAppSecret(),
      )
        .update(encodedPayload)
        .digest('base64url');

    const suppliedBuffer =
      Buffer.from(
        suppliedSignature,
        'utf8',
      );

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        'utf8',
      );

    if (
      suppliedBuffer.length !==
        expectedBuffer.length ||
      !timingSafeEqual(
        suppliedBuffer,
        expectedBuffer,
      )
    ) {
      throw new BadRequestException(
        'Facebook OAuth state signature is invalid.',
      );
    }

    let payload:
      OAuthStatePayload;

    try {
      payload =
        JSON.parse(
          Buffer.from(
            encodedPayload,
            'base64url',
          ).toString('utf8'),
        ) as OAuthStatePayload;
    } catch {
      throw new BadRequestException(
        'Facebook OAuth state could not be decoded.',
      );
    }

    if (
      !payload.brandId ||
      !payload.nonce ||
      !payload.expiresAt
    ) {
      throw new BadRequestException(
        'Facebook OAuth state is incomplete.',
      );
    }

    if (
      payload.expiresAt <
      Date.now()
    ) {
      throw new BadRequestException(
        'Facebook OAuth request has expired. Start the connection again.',
      );
    }

    return payload;
  }

  private throwFacebookError(
    responseOk: boolean,
    error?:
      FacebookOAuthTokenResponse['error'],
  ) {
    if (
      responseOk &&
      !error
    ) {
      return;
    }

    const details = [
      error?.message ||
        'Facebook OAuth request failed.',
      error?.code
        ? `Code ${error.code}`
        : null,
      error?.error_subcode
        ? `Subcode ${error.error_subcode}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

    throw new BadRequestException(
      details,
    );
  }

  private getAppId() {
    return this.requireConfig(
      'FACEBOOK_APP_ID',
    );
  }

  private getAppSecret() {
    return this.requireConfig(
      'FACEBOOK_APP_SECRET',
    );
  }

  private getRedirectUri() {
    return this.requireConfig(
      'FACEBOOK_OAUTH_REDIRECT_URI',
    );
  }

  private getSuccessUrl() {
    return this.requireConfig(
      'FACEBOOK_OAUTH_SUCCESS_URL',
    );
  }

  private getGraphBaseUrl() {
    const version =
      this.configService.get<string>(
        'FACEBOOK_GRAPH_API_VERSION',
      )?.trim() || 'v25.0';

    return [
      'https://graph.facebook.com',
      version,
    ].join('/');
  }

  private requireConfig(
    key: string,
  ) {
    const value =
      this.configService.get<string>(
        key,
      )?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `${key} is not configured.`,
      );
    }

    return value;
  }
}
