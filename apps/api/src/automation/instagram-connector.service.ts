import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type InstagramApiResponse = {
  id?: string;
  username?: string;
  name?: string;
  permalink?: string;
  error?: { message?: string; error_user_msg?: string };
};

export type InstagramApiCredentials = {
  instagramUserId: string;
  accessToken: string;
};

@Injectable()
export class InstagramConnectorService {
  constructor(private readonly config: ConfigService) {}

  async testConnection(credentials?: Partial<InstagramApiCredentials>) {
    const resolved = this.requireCredentials(credentials);
    const account = await this.graphGet(
      resolved.instagramUserId,
      resolved.accessToken,
      { fields: 'id,username,name' },
    );
    return {
      connected: true,
      account: {
        id: account.id ?? resolved.instagramUserId,
        username: account.username ?? null,
        name: account.name ?? null,
      },
    };
  }

  async publish(
    input: InstagramApiCredentials & {
      caption: string;
      mediaUrls?: string[];
    },
  ) {
    const credentials = this.requireCredentials(input);
    const caption = input.caption?.trim();
    const mediaUrls = (input.mediaUrls ?? [])
      .map((url) => url?.trim())
      .filter((url): url is string => Boolean(url));

    if (!caption) {
      throw new BadRequestException('Instagram caption cannot be empty.');
    }
    if (!mediaUrls.length) {
      throw new BadRequestException(
        'Instagram API publishing requires an image asset.',
      );
    }

    let container: InstagramApiResponse;
    if (mediaUrls.length === 1) {
      container = await this.graphPost(
        credentials.instagramUserId,
        credentials.accessToken,
        { image_url: mediaUrls[0], caption },
      );
    } else {
      const children = await Promise.all(
        mediaUrls.map((imageUrl) =>
          this.graphPost(
            credentials.instagramUserId,
            credentials.accessToken,
            { image_url: imageUrl, is_carousel_item: 'true' },
          ),
        ),
      );
      const childIds = children
        .map((child) => child.id)
        .filter((id): id is string => Boolean(id));
      if (childIds.length !== mediaUrls.length) {
        throw new Error(
          'Instagram API did not return all carousel item IDs.',
        );
      }
      container = await this.graphPost(
        credentials.instagramUserId,
        credentials.accessToken,
        {
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          caption,
        },
      );
    }

    if (!container.id) {
      throw new Error('Instagram API did not return a media container ID.');
    }

    const published = await this.graphPost(
      credentials.instagramUserId,
      credentials.accessToken,
      { creation_id: container.id },
    );
    const id = published.id ?? container.id;
    const permalink = (
      await this.graphGet(id, credentials.accessToken, {
        fields: 'permalink',
      })
    ).permalink ?? null;

    return { id, creationId: container.id, permalink };
  }

  private requireCredentials(
    credentials?: Partial<InstagramApiCredentials>,
  ): InstagramApiCredentials {
    const instagramUserId = credentials?.instagramUserId?.trim();
    const accessToken = credentials?.accessToken?.trim();
    if (!instagramUserId) {
      throw new BadRequestException(
        'Instagram Business Account ID is required for API fallback.',
      );
    }
    if (!accessToken) {
      throw new BadRequestException(
        'Instagram API access token is required for API fallback.',
      );
    }
    return { instagramUserId, accessToken };
  }

  private apiVersion() {
    return this.config.get<string>('FACEBOOK_GRAPH_API_VERSION')?.trim() || 'v25.0';
  }

  private async graphGet(
    path: string,
    accessToken: string,
    query: Record<string, string>,
  ) {
    const url = new URL(
      `https://graph.facebook.com/${this.apiVersion()}/${path}`,
    );
    Object.entries({ ...query, access_token: accessToken }).forEach(
      ([key, value]) => url.searchParams.set(key, value),
    );
    const response = await fetch(url);
    const body = (await response.json()) as InstagramApiResponse;
    this.throwApiError(response.ok, body.error);
    return body;
  }

  private async graphPost(
    path: string,
    accessToken: string,
    payload: Record<string, string>,
  ) {
    const response = await fetch(
      `https://graph.facebook.com/${this.apiVersion()}/${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...payload, access_token: accessToken }),
      },
    );
    const body = (await response.json()) as InstagramApiResponse;
    this.throwApiError(response.ok, body.error);
    return body;
  }

  private throwApiError(
    ok: boolean,
    error?: InstagramApiResponse['error'],
  ) {
    if (ok && !error) return;
    throw new Error(
      error?.error_user_msg ||
        error?.message ||
        'Instagram Graph API request failed.',
    );
  }
}
