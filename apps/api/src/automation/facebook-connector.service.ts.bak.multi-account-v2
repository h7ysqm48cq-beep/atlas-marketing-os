import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

@Injectable()
export class FacebookConnectorService {
  constructor(
    private readonly configService:
      ConfigService,
  ) {}

  async testConnection() {
    const page = await this.graphGet<FacebookPage>(
      this.getPageId(),
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

  async sendTestPost() {
    const result = await this.publishPost(
      '✅ Atlas Facebook connection test successful.',
    );

    return {
      published: true,
      postId: result.id,
      pageId: this.getPageId(),
      publishedAt:
        new Date().toISOString(),
    };
  }

  async publish(
    message: string,
    mediaUrls: string[] = [],
    link?: string,
  ) {
    const firstMediaUrl =
      mediaUrls
        .map((url) => url?.trim())
        .find(Boolean);

    if (firstMediaUrl) {
      return this.publishPhoto(
        message,
        firstMediaUrl,
      );
    }

    return this.publishPost(
      message,
      link,
    );
  }

  async publishPhoto(
    caption: string,
    mediaUrl: string,
  ) {
    const cleanCaption =
      caption?.trim();

    if (!cleanCaption) {
      throw new BadRequestException(
        'Facebook caption cannot be empty.',
      );
    }

    const media =
      await this.fetchMedia(mediaUrl);

    const form =
      new FormData();

    form.set(
      'caption',
      cleanCaption,
    );

    form.set(
      'access_token',
      this.getAccessToken(),
    );

    form.set(
      'source',
      media.blob,
      media.filename,
    );

    const response =
      await fetch(
        `${this.getBaseUrl()}/${this.getPageId()}/photos`,
        {
          method: 'POST',
          body: form,
        },
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
    message: string,
    link?: string,
  ) {
    const cleanMessage =
      message?.trim();

    if (!cleanMessage) {
      throw new BadRequestException(
        'Facebook message cannot be empty.',
      );
    }

    const payload:
      Record<string, string> = {
        message: cleanMessage,
      };

    if (link?.trim()) {
      payload.link = link.trim();
    }

    return this.graphPost<FacebookPostResult>(
      `${this.getPageId()}/feed`,
      payload,
    );
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
      await response.arrayBuffer();

    return {
      filename,
      blob: new Blob(
        [bytes],
        {
          type: contentType,
        },
      ),
    };
  }

  private getPageId() {
    const pageId =
      this.configService.get<string>(
        'FACEBOOK_PAGE_ID',
      );

    if (
      !pageId?.trim() ||
      pageId ===
        'PASTE_YOUR_PAGE_ID_HERE'
    ) {
      throw new BadRequestException(
        'FACEBOOK_PAGE_ID is not configured.',
      );
    }

    return pageId.trim();
  }

  private getAccessToken() {
    const token =
      this.configService.get<string>(
        'FACEBOOK_PAGE_ACCESS_TOKEN',
      );

    if (
      !token?.trim() ||
      token ===
        'PASTE_YOUR_PAGE_ACCESS_TOKEN_HERE'
    ) {
      throw new BadRequestException(
        'FACEBOOK_PAGE_ACCESS_TOKEN is not configured.',
      );
    }

    return token.trim();
  }

  private getApiVersion() {
    const value =
      this.configService.get<string>(
        'FACEBOOK_GRAPH_API_VERSION',
      );

    return (
      value?.trim() ||
      'v23.0'
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
  ): Promise<T> {
    const url = new URL(
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
      this.getAccessToken(),
    );

    const response =
      await fetch(url);

    const body =
      (await response.json()) as FacebookApiResponse<T>;

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
      this.getAccessToken(),
    );

    const response =
      await fetch(
        `${this.getBaseUrl()}/${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded',
          },
          body,
        },
      );

    const result =
      (await response.json()) as FacebookApiResponse<T>;

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
