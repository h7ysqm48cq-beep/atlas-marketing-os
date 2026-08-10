import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
};

export type TelegramChannelCredentials = {
  botToken: string;
  chatId: string;
};

@Injectable()
export class TelegramConnectorService {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  async inspectBot(botToken: string) {
    const bot = await this.call<TelegramUser>(
      'getMe',
      {},
      botToken,
    );

    return {
      id: bot.id,
      name: bot.first_name,
      username: bot.username ?? null,
    };
  }

  async testConnection(
    credentials?: TelegramChannelCredentials,
  ) {
    const bot = await this.call<TelegramUser>(
      'getMe',
      {},
      credentials?.botToken,
    );

    const chatId = this.getChatId(credentials?.chatId);

    const chat = await this.call<TelegramChat>(
      'getChat',
      {
        chat_id: chatId,
      },
      credentials?.botToken,
    );

    return {
      connected: true,
      bot: {
        id: bot.id,
        name: bot.first_name,
        username: bot.username ?? null,
      },
      channel: {
        id: chat.id,
        title: chat.title ?? null,
        username: chat.username ?? null,
        type: chat.type,
      },
    };
  }

  async sendTestMessage() {
    const result =
      await this.sendMessage(
        '✅ Atlas Telegram connection test successful.',
      );

    return {
      published: true,
      messageId: result.message_id,
      chatId: result.chat.id,
      sentAt: new Date(
        result.date * 1000,
      ).toISOString(),
    };
  }

  async publish(
    text: string,
    mediaUrls: string[] = [],
    credentials?: TelegramChannelCredentials,
  ): Promise<TelegramMessage> {
    const firstMediaUrl =
      mediaUrls
        .map((url) => url?.trim())
        .find(Boolean);

    if (firstMediaUrl) {
      if (text.trim().length <= 1024) {
        return this.sendPhoto(
          text,
          firstMediaUrl,
          credentials,
        );
      }

      await this.sendPhoto(
        'Atlas Sports News',
        firstMediaUrl,
        credentials,
      );

      return this.sendMessage(
        text,
        credentials,
      );
    }

    return this.sendMessage(text, credentials);
  }

  async sendPhoto(
    caption: string,
    mediaUrl: string,
    credentials?: TelegramChannelCredentials,
  ): Promise<TelegramMessage> {
    const cleanCaption =
      caption?.trim();

    if (!cleanCaption) {
      throw new BadRequestException(
        'Telegram caption cannot be empty.',
      );
    }

    const media =
      await this.fetchMedia(mediaUrl);

    const form =
      new FormData();

    form.set(
      'chat_id',
      this.getChatId(credentials?.chatId),
    );

    form.set(
      'caption',
      cleanCaption,
    );

    form.set(
      'photo',
      media.blob,
      media.filename,
    );

    return this.callMultipart<TelegramMessage>(
      'sendPhoto',
      form,
      credentials?.botToken,
    );
  }

  async sendMessage(
    text: string,
    credentials?: TelegramChannelCredentials,
  ): Promise<TelegramMessage> {
    const cleanText = text?.trim();

    if (!cleanText) {
      throw new BadRequestException(
        'Telegram message cannot be empty.',
      );
    }

    return this.call<TelegramMessage>(
      'sendMessage',
      {
        chat_id: this.getChatId(credentials?.chatId),
        text: cleanText,
        disable_web_page_preview: false,
      },
      credentials?.botToken,
    );
  }

  private getToken(override?: string) {
    if (override?.trim()) {
      return override.trim();
    }

    const token =
      this.configService.get<string>(
        'TELEGRAM_BOT_TOKEN',
      );

    if (
      !token ||
      token ===
        'PASTE_YOUR_BOT_TOKEN_HERE'
    ) {
      throw new BadRequestException(
        'TELEGRAM_BOT_TOKEN is not configured.',
      );
    }

    return token.trim();
  }

  private getChatId(override?: string) {
    if (override?.trim()) {
      return override.trim();
    }

    const chatId =
      this.configService.get<string>(
        'TELEGRAM_CHAT_ID',
      );

    if (!chatId?.trim()) {
      throw new BadRequestException(
        'TELEGRAM_CHAT_ID is not configured.',
      );
    }

    return chatId.trim();
  }

  private async fetchMedia(
    mediaUrl: string,
  ) {
    const cleanUrl =
      mediaUrl?.trim();

    if (!cleanUrl) {
      throw new BadRequestException(
        'Telegram media URL is required.',
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
        `Unable to read Telegram media: ${message}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        [
          'Unable to read Telegram media.',
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
        `Telegram media must be an image. Received ${contentType}.`,
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

  private async callMultipart<T>(
    method: string,
    form: FormData,
    token?: string,
  ): Promise<T> {
    const response =
      await fetch(
        `https://api.telegram.org/bot${this.getToken(token)}/${method}`,
        {
          method: 'POST',
          body: form,
        },
      );

    const body =
      (await response.json()) as
        TelegramApiResponse<T>;

    if (
      !response.ok ||
      !body.ok
    ) {
      throw new BadRequestException(
        body.description ||
          `Telegram API request failed: ${method}`,
      );
    }

    if (
      body.result === undefined
    ) {
      throw new BadRequestException(
        `Telegram API returned no result: ${method}`,
      );
    }

    return body.result;
  }

  private async call<T>(
    method: string,
    payload: Record<string, unknown>,
    token?: string,
  ): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.getToken(token)}/${method}`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const body =
      await response.json() as
        TelegramApiResponse<T>;

    if (!response.ok || !body.ok) {
      throw new BadRequestException(
        body.description ||
          `Telegram API request failed: ${method}`,
      );
    }

    if (body.result === undefined) {
      throw new BadRequestException(
        `Telegram API returned no result: ${method}`,
      );
    }

    return body.result;
  }
}
