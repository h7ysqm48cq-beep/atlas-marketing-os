import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import {
  ScheduledPostStatus,
  SocialChannelStatus,
  SocialPlatform,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { PublisherService } from './publisher.service';

type SportsStory = {
  title: string;
  link: string;
  publishedAt: string;
  imageUrl?: string;
};

@Injectable()
export class SportsNewsAutomationService {
  private readonly logger = new Logger(
    SportsNewsAutomationService.name,
  );

  private readonly campaignLink =
    'https://rebrand.ly/mgmbetae0dcf';

  private readonly newsTitle =
    '满贯门新闻 | MGM News';

  private readonly fallbackImage =
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=85';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly publisher: PublisherService,
  ) {}

  async run(slot: '09:00' | '20:00' | 'MANUAL') {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const jobKey = `[SPORTS-NEWS:${date}:${slot}]`;

    const duplicate = await this.prisma.scheduledPost.findFirst({
      where: { title: jobKey },
      select: { id: true, status: true },
    });

    if (duplicate) {
      this.logger.log(`${jobKey} already exists.`);
      return { skipped: true, reason: 'duplicate', post: duplicate };
    }

    const [brand, channel] = await Promise.all([
      this.prisma.brand.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.socialChannel.findFirst({
        where: {
          platform: SocialPlatform.TELEGRAM,
          status: SocialChannelStatus.CONNECTED,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    if (!brand || !channel) {
      throw new Error(
        'Sports news requires an active brand and a connected Telegram channel.',
      );
    }

    const stories = await this.fetchLatestStories();
    if (!stories.length) {
      throw new Error('No current sports stories were returned by the news feeds.');
    }

    const sources = stories
      .map(
        (story, index) =>
          `${index + 1}. ${story.title}\nPublished: ${story.publishedAt}\nSource: ${story.link}`,
      )
      .join('\n\n');

    const generated = await this.ai.generate({
      topic: [
        `Create a concise current sports-news bulletin for ${date}.`,
        'Use only the supplied headlines and links; do not invent scores, quotes, transfers or results.',
        'Write in natural Simplified Chinese followed by concise English.',
        `Do not write Atlas News. The title is added by the system as: ${this.newsTitle}`,
        'Include a short source line. Keep the full Telegram caption below 900 characters.',
        `End with this exact link on its own final line: ${this.campaignLink}`,
        '',
        'VERIFIED NEWS INPUT',
        sources,
      ].join('\n'),
      platforms: ['telegram'],
      style: 'Current, energetic, factual sports newsroom; bilingual Chinese and English; no betting claims',
      language: 'Simplified Chinese and English',
    });

    const content = this.normalizeCaption(generated.telegram);
    const mediaUrl =
      stories.find((story) => story.imageUrl)?.imageUrl ||
      this.fallbackImage;

    const post = await this.prisma.scheduledPost.create({
      data: {
        brandId: brand.id,
        channelId: channel.id,
        historyId: generated.historyId,
        platform: SocialPlatform.TELEGRAM,
        title: jobKey,
        content,
        mediaUrls: [mediaUrl],
        scheduledAt: new Date(),
        timezone: 'Asia/Kuala_Lumpur',
        status: ScheduledPostStatus.QUEUED,
      },
    });

    const publishResult = await this.publisher.run();
    return { skipped: false, post, stories, publishResult };
  }

  private normalizeCaption(value: string) {
    const withoutCampaignLink = value
      .replaceAll(this.campaignLink, '')
      .replace(
        /^\s*(?:atlas\s+news|满贯门新闻\s*[|｜·-]\s*mgm\s+news)\s*[:：-]?\s*/i,
        '',
      )
      .trim();
    const maxBodyLength =
      900 -
      this.newsTitle.length -
      this.campaignLink.length -
      4;
    const body =
      withoutCampaignLink.length > maxBodyLength
        ? `${withoutCampaignLink.slice(0, maxBodyLength - 1).trimEnd()}…`
        : withoutCampaignLink;

    return `${this.newsTitle}\n\n${body}\n\n${this.campaignLink}`;
  }

  private async fetchLatestStories(): Promise<SportsStory[]> {
    const feeds = [
      'https://feeds.bbci.co.uk/sport/rss.xml',
      'https://www.espn.com/espn/rss/news',
    ];

    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        const response = await fetch(feed, {
          headers: { 'User-Agent': 'AtlasMarketingOS/1.0' },
        });
        if (!response.ok) {
          throw new Error(`Sports feed returned HTTP ${response.status}.`);
        }
        return this.parseRss(await response.text());
      }),
    );

    const unique = new Map<string, SportsStory>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const story of result.value) {
        if (!unique.has(story.title)) unique.set(story.title, story);
      }
    }

    return [...unique.values()]
      .sort(
        (a, b) =>
          new Date(b.publishedAt).getTime() -
          new Date(a.publishedAt).getTime(),
      )
      .slice(0, 5);
  }

  private parseRss(xml: string): SportsStory[] {
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    return items
      .map<SportsStory | null>((item) => {
        const title = this.readTag(item, 'title');
        const link = this.readTag(item, 'link');
        const publishedAt = this.readTag(item, 'pubDate');
        const imageMatch = item.match(
          /<(?:media:content|enclosure)\b[^>]*\burl=["']([^"']+)["']/i,
        );

        if (!title || !link || !publishedAt) return null;
        const story: SportsStory = {
          title: this.decodeXml(title),
          link: this.decodeXml(link),
          publishedAt,
        };

        if (imageMatch?.[1]) {
          story.imageUrl = this.decodeXml(imageMatch[1]);
        }

        return story;
      })
      .filter((story): story is SportsStory => story !== null);
  }

  private readTag(value: string, tag: string) {
    const match = value.match(
      new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'),
    );
    return match?.[1]?.trim() || '';
  }

  private decodeXml(value: string) {
    return value
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');
  }
}
