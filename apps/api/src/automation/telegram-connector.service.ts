import { BadRequestException, Injectable } from '@nestjs/common';
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
  constructor(private readonly configService: ConfigService) {}

  async inspectBot(botToken: string) {
    const bot = await this.call<TelegramUser>('getMe', {}, botToken);

    return {
      id: bot.id,
      name: bot.first_name,
      username: bot.username ?? null,
    };
  }

  async testConnection(credentials?: TelegramChannelCredentials) {
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
    const result = await this.sendMessage(
      '✅ M-Sports Telegram connection test successful.',
    );

    return {
      published: true,
      messageId: result.message_id,
      chatId: result.chat.id,
      sentAt: new Date(result.date * 1000).toISOString(),
    };
  }

  async publish(
    text: string,
    mediaUrls: string[] = [],
    credentials?: TelegramChannelCredentials,
  ): Promise<TelegramMessage> {
    const cleanText = text?.trim();

    if (!cleanText) {
      throw new BadRequestException('Telegram message cannot be empty.');
    }

    const firstMediaUrl = mediaUrls.map((url) => url?.trim()).find(Boolean);

    let lastMessage: TelegramMessage | null = null;

    if (firstMediaUrl) {
      /*
       * A Telegram media publication must remain one post.
       * The image caption is the complete visible publication.
       * Never resend the same article as continuation messages.
       */
      const caption = this.buildPhotoCaption(cleanText);

      lastMessage = await this.sendPhoto(caption, firstMediaUrl, credentials);
    } else {
      const chunks = this.splitMessage(cleanText);

      for (const chunk of chunks) {
        lastMessage = await this.sendMessage(chunk, credentials);
      }
    }

    if (!lastMessage) {
      throw new BadRequestException(
        'Telegram publication returned no message.',
      );
    }

    return lastMessage;
  }

  private buildPhotoCaption(text: string): string {
    const limit = 900;

    if (text.length <= limit) {
      return text;
    }

    const paragraphs = text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    let caption = '';

    for (const paragraph of paragraphs) {
      const candidate = caption ? `${caption}\n\n${paragraph}` : paragraph;

      if (candidate.length > limit) {
        break;
      }

      caption = candidate;
    }

    if (caption) {
      return caption;
    }

    return `${text.slice(0, limit - 1).trimEnd()}…`;
  }

  private removePhotoCaption(fullText: string, caption: string): string {
    const cleanFullText = fullText.trim();
    const cleanCaption = caption.trim();

    if (!cleanFullText || !cleanCaption) {
      return cleanFullText;
    }

    if (cleanFullText === cleanCaption) {
      return '';
    }

    if (cleanFullText.startsWith(cleanCaption)) {
      return cleanFullText.slice(cleanCaption.length).trim();
    }

    if (cleanCaption.endsWith('…') && cleanCaption.length > 1) {
      const prefix = cleanCaption.slice(0, -1).trimEnd();

      if (cleanFullText.startsWith(prefix)) {
        return cleanFullText.slice(prefix.length).trim();
      }
    }

    /*
     * Safety fallback:
     * if caption extraction cannot be matched exactly,
     * do not resend the entire original article.
     */
    return '';
  }

  private splitMessage(text: string, limit = 3800): string[] {
    const clean = text.trim();

    if (!clean) {
      return [];
    }

    if (clean.length <= limit) {
      return [clean];
    }

    const chunks: string[] = [];
    let remaining = clean;

    while (remaining.length > limit) {
      const window = remaining.slice(0, limit);
      const paragraphBreak = window.lastIndexOf('\n\n');
      const lineBreak = window.lastIndexOf('\n');
      const punctuationBreak = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
      );

      let splitAt = Math.max(paragraphBreak, lineBreak, punctuationBreak);

      if (splitAt < Math.floor(limit * 0.5)) {
        splitAt = limit;
      } else {
        const character = remaining.charAt(splitAt);

        if (character === '。' || character === '！' || character === '？') {
          splitAt += 1;
        }
      }

      const chunk = remaining.slice(0, splitAt).trim();

      if (chunk) {
        chunks.push(chunk);
      }

      remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  async sendPhoto(
    caption: string,
    mediaUrl: string,
    credentials?: TelegramChannelCredentials,
  ): Promise<TelegramMessage> {
    const cleanCaption = caption?.trim();

    if (!cleanCaption) {
      throw new BadRequestException('Telegram caption cannot be empty.');
    }

    const media = await this.fetchMedia(mediaUrl);

    const form = new FormData();

    form.set('chat_id', this.getChatId(credentials?.chatId));

    form.set('caption', cleanCaption);

    form.set('photo', media.blob, media.filename);

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
      throw new BadRequestException('Telegram message cannot be empty.');
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

    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token || token === 'PASTE_YOUR_BOT_TOKEN_HERE') {
      throw new BadRequestException('TELEGRAM_BOT_TOKEN is not configured.');
    }

    return token.trim();
  }

  private getChatId(override?: string) {
    if (override?.trim()) {
      return override.trim();
    }

    const chatId = this.configService.get<string>('TELEGRAM_CHAT_ID');

    if (!chatId?.trim()) {
      throw new BadRequestException('TELEGRAM_CHAT_ID is not configured.');
    }

    return chatId.trim();
  }

  private async fetchMedia(mediaUrl: string) {
    const cleanUrl = mediaUrl?.trim();

    if (!cleanUrl) {
      throw new BadRequestException('Telegram media URL is required.');
    }

    if (cleanUrl.startsWith('data:image/')) {
      return this.dataImage(cleanUrl, 'm-sports-news');
    }

    let response: Response;

    try {
      response = await fetch(cleanUrl);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown media fetch error';

      throw new BadRequestException(
        `Unable to read Telegram media: ${message}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        ['Unable to read Telegram media.', `HTTP ${response.status}`].join(' '),
      );
    }

    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    if (!contentType.startsWith('image/')) {
      throw new BadRequestException(
        `Telegram media must be an image. Received ${contentType}.`,
      );
    }

    const pathname = new URL(cleanUrl).pathname;

    const filename = pathname.split('/').pop() || 'm-sports-image';

    const bytes = await response.arrayBuffer();

    return {
      filename,
      blob: new Blob([bytes], {
        type: contentType,
      }),
    };
  }

  private dataImage(value: string, name: string) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);

    if (!match) {
      throw new BadRequestException('Invalid generated image data.');
    }

    const type = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    const ext =
      type === 'image/jpeg'
        ? 'jpg'
        : type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';

    return {
      filename: `${name}.${ext}`,
      blob: new Blob([bytes], { type }),
    };
  }

  private async callMultipart<T>(
    method: string,
    form: FormData,
    token?: string,
  ): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.getToken(token)}/${method}`,
      {
        method: 'POST',
        body: form,
      },
    );

    const body = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !body.ok) {
      throw new BadRequestException(
        body.description || `Telegram API request failed: ${method}`,
      );
    }

    if (body.result === undefined) {
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
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const body = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !body.ok) {
      throw new BadRequestException(
        body.description || `Telegram API request failed: ${method}`,
      );
    }

    if (body.result === undefined) {
      throw new BadRequestException(
        `Telegram API returned no result: ${method}`,
      );
    }

    return body.result;
  }

  async publishPhotoUrlDirect(input: {
    botToken: string;
    chatId: string;
    photoUrl: string;
    caption: string;
  }) {
    const apiBase = `https://api.telegram.org/bot${input.botToken}`;

    const caption = (input.caption || '').slice(0, 1000);

    const photoResponse = await fetch(`${apiBase}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        photo: input.photoUrl,
        caption,
      }),
    });

    const photoBody = await photoResponse.json().catch(() => null);

    if (photoResponse.ok && photoBody?.ok !== false) {
      return photoBody;
    }

    const textResponse = await fetch(`${apiBase}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: caption,
        disable_web_page_preview: true,
      }),
    });

    const textBody = await textResponse.json().catch(() => null);

    if (!textResponse.ok || textBody?.ok === false) {
      throw new Error(
        textBody?.description ||
          photoBody?.description ||
          `Telegram publish failed: ${textResponse.status}`,
      );
    }

    return textBody;
  }
}
