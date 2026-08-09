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

@Injectable()
export class TelegramConnectorService {
  constructor(private readonly configService: ConfigService) {}
  async testConnection() {
    const bot = await this.call<TelegramUser>('getMe', {});
    const chatId = this.getChatId();
    const chat = await this.call<TelegramChat>('getChat', { chat_id: chatId });
    return {
      connected: true,
      bot: { id: bot.id, name: bot.first_name, username: bot.username ?? null },
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
  async publish(text: string, mediaUrls: string[] = []) {
    const clean = text?.trim();

    if (!clean) {
      throw new BadRequestException('Telegram message cannot be empty.');
    }

    const first = mediaUrls.map((u) => u?.trim()).find(Boolean);

    const chunks = this.splitMessage(clean);

    let photoResult: TelegramMessage | null = null;
    const messageResults: TelegramMessage[] = [];

    if (first) {
      /*
       * Telegram photo captions have a much smaller limit
       * than normal messages.
       *
       * Use only a compact preview as the image caption.
       * The complete article is published afterwards as
       * normal Telegram messages.
       */
      const caption = this.buildPhotoCaption(clean);

      photoResult = await this.sendPhoto(caption, first);
    }

    /*
     * Preserve the complete article.
     *
     * When there is a photo, the caption is only a preview,
     * so the full article is still sent here.
     *
     * Without a photo, this becomes the complete publication
     * flow as well.
     */
    for (const chunk of chunks) {
      const result = await this.sendMessage(chunk);
      messageResults.push(result);
    }

    const lastMessage =
      messageResults[messageResults.length - 1] ?? photoResult;

    if (!lastMessage) {
      throw new BadRequestException(
        'Telegram publication returned no message.',
      );
    }

    return {
      published: true,
      messageId: lastMessage.message_id,
      message_id: lastMessage.message_id,
      chatId: lastMessage.chat.id,
      sentAt: new Date(lastMessage.date * 1000).toISOString(),
      photoMessageId: photoResult?.message_id ?? null,
      textMessageIds: messageResults.map((message) => message.message_id),
      partCount: messageResults.length + (photoResult ? 1 : 0),
    };
  }

  private buildPhotoCaption(text: string): string {
    /*
     * Keep comfortably below Telegram's photo-caption
     * ceiling. 900 characters gives us room for Unicode
     * differences and future formatting.
     */
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

  private splitMessage(text: string, limit = 3800): string[] {
    /*
     * Telegram normal messages allow more text than photo
     * captions. Keep below the hard ceiling for safety.
     *
     * Prefer:
     *   1. paragraph boundaries
     *   2. line boundaries
     *   3. sentence-like punctuation
     *   4. hard split only as a last resort
     */
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

      const punctuationCandidates = [
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
      ];

      const punctuationBreak = Math.max(...punctuationCandidates);

      let splitAt = Math.max(paragraphBreak, lineBreak, punctuationBreak);

      /*
       * Avoid producing a tiny first chunk just because an
       * early newline exists.
       */
      if (splitAt < Math.floor(limit * 0.5)) {
        splitAt = limit;
      } else {
        /*
         * Preserve sentence-ending punctuation where
         * possible.
         */
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
  async sendPhoto(caption: string, mediaUrl: string) {
    const clean = caption?.trim();
    if (!clean)
      throw new BadRequestException('Telegram caption cannot be empty.');
    const media = await this.fetchMedia(mediaUrl);
    const form = new FormData();
    form.set('chat_id', this.getChatId());
    form.set('caption', clean);
    form.set('photo', media.blob, media.filename);
    return this.callMultipart<TelegramMessage>('sendPhoto', form);
  }
  async sendMessage(text: string) {
    const clean = text?.trim();
    if (!clean)
      throw new BadRequestException('Telegram message cannot be empty.');
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: this.getChatId(),
      text: clean,
      disable_web_page_preview: false,
    });
  }
  private getToken() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token || token === 'PASTE_YOUR_BOT_TOKEN_HERE')
      throw new BadRequestException('TELEGRAM_BOT_TOKEN is not configured.');
    return token.trim();
  }
  private getChatId() {
    const id = this.configService.get<string>('TELEGRAM_CHAT_ID');
    if (!id?.trim())
      throw new BadRequestException('TELEGRAM_CHAT_ID is not configured.');
    return id.trim();
  }
  private async fetchMedia(mediaUrl: string) {
    const clean = mediaUrl?.trim();
    if (!clean)
      throw new BadRequestException('Telegram media URL is required.');
    if (clean.startsWith('data:image/'))
      return this.dataImage(clean, 'm-sports-news');
    let response: Response;
    try {
      response = await fetch(clean);
    } catch (error) {
      throw new BadRequestException(
        `Unable to read Telegram media: ${error instanceof Error ? error.message : 'Unknown media fetch error'}`,
      );
    }
    if (!response.ok)
      throw new BadRequestException(
        `Unable to read Telegram media. HTTP ${response.status}`,
      );
    const type =
      response.headers.get('content-type') || 'application/octet-stream';
    if (!type.startsWith('image/'))
      throw new BadRequestException(
        `Telegram media must be an image. Received ${type}.`,
      );
    const pathname = new URL(clean).pathname;
    const filename = pathname.split('/').pop() || 'm-sports-image';
    return {
      filename,
      blob: new Blob([await response.arrayBuffer()], { type }),
    };
  }
  private dataImage(value: string, name: string) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);
    if (!match) throw new BadRequestException('Invalid generated image data.');
    const type = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    const ext =
      type === 'image/jpeg'
        ? 'jpg'
        : type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    return { filename: `${name}.${ext}`, blob: new Blob([bytes], { type }) };
  }
  private async callMultipart<T>(method: string, form: FormData): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.getToken()}/${method}`,
      { method: 'POST', body: form },
    );
    const body = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !body.ok)
      throw new BadRequestException(
        body.description || `Telegram API request failed: ${method}`,
      );
    if (body.result === undefined)
      throw new BadRequestException(
        `Telegram API returned no result: ${method}`,
      );
    return body.result;
  }
  private async call<T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.getToken()}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const body = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !body.ok)
      throw new BadRequestException(
        body.description || `Telegram API request failed: ${method}`,
      );
    if (body.result === undefined)
      throw new BadRequestException(
        `Telegram API returned no result: ${method}`,
      );
    return body.result;
  }
}
