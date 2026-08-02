import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  fetch as undiciFetch,
  FormData as UndiciFormData,
  ProxyAgent,
  type Dispatcher,
} from 'undici';
import { File } from 'node:buffer';

type FacebookApiError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type FacebookApiResponse<T> = T & {
  error?: FacebookApiError;
};

type FacebookPage = {
  id: string;
  name: string;
  username?: string;
  link?: string;
  category?: string;
  fan_count?: number;
};

type FacebookPostResult = {
  id: string;
};

type FacebookPhotoResult = {
  id: string;
  post_id?: string;
};

export type FacebookChannelCredentials = {
  pageId: string;
  accessToken: string;
  proxyUrl?: string | null;
};

export type FacebookPublishInput =
  FacebookChannelCredentials & {
    message: string;
    mediaUrls?: string[];
    link?: string;
  };

@Injectable()
export class FacebookConnectorService {
  constructor(
    private readonly configService:
      ConfigService,
  ) {}

  async testConnection(
    credentials?: FacebookChannelCredentials,
  ) {
    const resolved =
      this.requireCredentials(credentials);

    const page =
      await this.graphGet<FacebookPage>(
        resolved.pageId,
        {
          fields: [
            'id',
            'name',
            'username',
            'link',
            'category',
            'fan_count',
          ].join(','),
        },
        resolved.accessToken,
        resolved.proxyUrl,
      );

    return {
      connected: true,
      page: {
        id: page.id,
        name: page.name,
        username:
          page.username ?? null,
        link:
          page.link ?? null,
        category:
          page.category ?? null,
        followers:
          page.fan_count ?? null,
      },
      graphApiVersion:
        this.getApiVersion(),
    };
  }

  async sendTestPost(
    credentials?: FacebookChannelCredentials,
  ) {
    const resolved =
      this.requireCredentials(credentials);

    const result =
      await this.publishPost({
        ...resolved,
        message:
          '✅ Atlas Facebook connection test successful.',
      });

    return {
      published: true,
      postId: result.id,
      pageId: resolved.pageId,
      publishedAt:
        new Date().toISOString(),
    };
  }

  async publish(
    input: FacebookPublishInput,
  ) {
    const credentials =
      this.requireCredentials(input);

    const firstMediaUrl =
      (input.mediaUrls ?? [])
        .map((url) => url?.trim())
        .find(Boolean);

    if (firstMediaUrl) {
      return this.publishPostWithPhoto({
        ...credentials,
        message: input.message,
        mediaUrl: firstMediaUrl,
        link: input.link,
      });
    }

    return this.publishPost({
      ...credentials,
      message: input.message,
      link: input.link,
    });
  }

  /**
   * Upload the image as unpublished media, then attach it to a Page feed
   * post. Posting directly to /photos makes Facebook classify the item as a
   * Photo instead of a normal Page post.
   */
  async publishPostWithPhoto(
    input: FacebookChannelCredentials & {
      message: string;
      mediaUrl: string;
      link?: string;
    },
  ) {
    const credentials = this.requireCredentials(input);
    const media = await this.uploadUnpublishedPhoto(input);
    const payload: Record<string, string> = {
      message: input.message?.trim(),
      'attached_media[0]': JSON.stringify({
        media_fbid: media.id,
      }),
    };

    if (!payload.message) {
      throw new BadRequestException(
        'Facebook message cannot be empty.',
      );
    }

    if (input.link?.trim()) {
      payload.link = input.link.trim();
    }

    return this.graphPost<FacebookPostResult>(
      `${credentials.pageId}/feed`,
      payload,
      credentials.accessToken,
      credentials.proxyUrl,
    );
  }

  private async uploadUnpublishedPhoto(
    input: FacebookChannelCredentials & {
      mediaUrl: string;
    },
  ) {
    const credentials = this.requireCredentials(input);
    const media = await this.fetchMedia(input.mediaUrl);
    const form = new UndiciFormData();

    form.set('published', 'false');
    form.set('access_token', credentials.accessToken);
    form.set('source', media.file);

    const response = await this.request(
      `${this.getBaseUrl()}/${credentials.pageId}/photos`,
      { method: 'POST', body: form },
      credentials.proxyUrl,
    );
    const result =
      (await response.json()) as FacebookApiResponse<FacebookPhotoResult>;

    this.throwFacebookError(response.ok, result.error);
    return result;
  }

  async publishPhoto(
    input: FacebookChannelCredentials & {
      caption: string;
      mediaUrl: string;
    },
  ) {
    const credentials =
      this.requireCredentials(input);

    const cleanCaption =
      input.caption?.trim();

    if (!cleanCaption) {
      throw new BadRequestException(
        'Facebook caption cannot be empty.',
      );
    }

    const media =
      await this.fetchMedia(
        input.mediaUrl,
      );

    const form =
      new UndiciFormData();

    form.set(
      'caption',
      cleanCaption,
    );

    form.set(
      'access_token',
      credentials.accessToken,
    );

    form.set(
      'source',
      media.file,
    );

    const response =
      await this.request(
        [
          this.getBaseUrl(),
          credentials.pageId,
          'photos',
        ].join('/'),
        {
          method: 'POST',
          body: form,
        },
        credentials.proxyUrl,
      );

    const result =
      (await response.json()) as
        FacebookApiResponse<FacebookPhotoResult>;

    this.throwFacebookError(
      response.ok,
      result.error,
    );

    return result;
  }


  async publishPost(
    input: FacebookChannelCredentials & {
      message: string;
      link?: string;
    },
  ) {
    const credentials =
      this.requireCredentials(input);

    const cleanMessage =
      input.message?.trim();

    if (!cleanMessage) {
      throw new BadRequestException(
        'Facebook message cannot be empty.',
      );
    }

    const payload:
      Record<string, string> = {
        message: cleanMessage,
      };

    if (input.link?.trim()) {
      payload.link =
        input.link.trim();
    }

    return this.graphPost<FacebookPostResult>(
      `${credentials.pageId}/feed`,
      payload,
      credentials.accessToken,
    );
  }

  private createDispatcher(
    proxyUrl?: string | null,
  ): Dispatcher | undefined {
    const cleanProxyUrl =
      proxyUrl?.trim();

    if (!cleanProxyUrl) {
      return undefined;
    }

    return new ProxyAgent(
      cleanProxyUrl,
    );
  }

  private async request(
    input:
      string | URL,
    init: Parameters<
      typeof undiciFetch
    >[1] = {},
    proxyUrl?: string | null,
  ) {
    const dispatcher =
      this.createDispatcher(
        proxyUrl,
      );

    try {
      return await undiciFetch(
        input,
        {
          ...init,
          dispatcher,
        },
      );
    } finally {
      if (dispatcher) {
        await dispatcher.close();
      }
    }
  }


  private requireCredentials(
    credentials?:
      Partial<FacebookChannelCredentials>,
  ): FacebookChannelCredentials {
    const pageId =
      credentials?.pageId?.trim();

    const accessToken =
      credentials?.accessToken?.trim();

    if (!pageId) {
      throw new BadRequestException(
        'Facebook channel Page ID is required.',
      );
    }

    if (!accessToken) {
      throw new BadRequestException(
        'Facebook channel access token is required.',
      );
    }

    return {
      pageId,
      accessToken,
      proxyUrl:
        credentials?.proxyUrl
          ?.trim() ||
        null,
    };
  }

  private async fetchMedia(
    mediaUrl: string,
  ) {
    const cleanUrl =
      mediaUrl?.trim();

    if (!cleanUrl) {
      throw new BadRequestException(
        'Facebook media URL is required.',
      );
    }

    let response: Response;

    try {
      response =
        await fetch(cleanUrl);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown media fetch error';

      throw new BadRequestException(
        `Unable to read Facebook media: ${message}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        [
          'Unable to read Facebook media.',
          `HTTP ${response.status}`,
        ].join(' '),
      );
    }

    const contentType =
      response.headers.get(
        'content-type',
      ) || 'application/octet-stream';

    if (
      !contentType.startsWith(
        'image/',
      )
    ) {
      throw new BadRequestException(
        `Facebook media must be an image. Received ${contentType}.`,
      );
    }

    const pathname =
      new URL(cleanUrl).pathname;

    const filename =
      pathname.split('/').pop() ||
      'atlas-image';

    const bytes =
      Buffer.from(
        await response.arrayBuffer(),
      );

    return {
      filename,
      file: new File(
        [bytes],
        filename,
        {
          type: contentType,
        },
      ),
    };
  }

  private getApiVersion() {
    const value =
      this.configService.get<string>(
        'FACEBOOK_GRAPH_API_VERSION',
      );

    return (
      value?.trim() ||
      'v25.0'
    );
  }

  private getBaseUrl() {
    return [
      'https://graph.facebook.com',
      this.getApiVersion(),
    ].join('/');
  }

  private async graphGet<T>(
    path: string,
    query:
      Record<string, string>,
    accessToken: string,
    proxyUrl?: string | null,
  ): Promise<T> {
    const url =
      new URL(
        `${this.getBaseUrl()}/${path}`,
      );

    for (
      const [key, value]
      of Object.entries(query)
    ) {
      url.searchParams.set(
        key,
        value,
      );
    }

    url.searchParams.set(
      'access_token',
      accessToken,
    );

    const response =
      await this.request(
        url,
        {},
        proxyUrl,
      );

    const body =
      (await response.json()) as
        FacebookApiResponse<T>;

    this.throwFacebookError(
      response.ok,
      body.error,
    );

    return body;
  }

  private async graphPost<T>(
    path: string,
    payload:
      Record<string, string>,
    accessToken: string,
    proxyUrl?: string | null,
  ): Promise<T> {
    const body =
      new URLSearchParams();

    for (
      const [key, value]
      of Object.entries(payload)
    ) {
      body.set(key, value);
    }

    body.set(
      'access_token',
      accessToken,
    );

    const response =
      await this.request(
        `${this.getBaseUrl()}/${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded',
          },
          body,
        },
        proxyUrl,
      );

    const result =
      (await response.json()) as
        FacebookApiResponse<T>;

    this.throwFacebookError(
      response.ok,
      result.error,
    );

    return result;
  }

  private throwFacebookError(
    responseOk: boolean,
    error?: FacebookApiError,
  ) {
    if (
      responseOk &&
      !error
    ) {
      return;
    }

    const details = [
      error?.message ||
        'Facebook Graph API request failed.',
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
}
