import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser } from 'fast-xml-parser';
import { SportsNewsSource } from '../automation/sports-news-source-validator.service';

export type SportsNewsSourceResult = {
  sources: SportsNewsSource[];
  provider: string;
  fetchedAt: string;
};

type FeedDefinition = {
  name: string;
  query: string;
};

@Injectable()
export class SportsNewsSourceService {
  private readonly logger = new Logger(SportsNewsSourceService.name);

  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });

  private readonly feeds: FeedDefinition[] = [
    {
      name: 'football',
      query:
        'football OR Premier League OR Champions League OR La Liga OR Serie A OR Bundesliga',
    },
    {
      name: 'malaysia-football',
      query: 'Malaysia football OR Harimau Malaya OR Malaysian Super League',
    },
    {
      name: 'badminton',
      query: 'badminton OR BWF OR Malaysia badminton',
    },
    {
      name: 'basketball',
      query: 'NBA OR basketball',
    },
    {
      name: 'formula-one',
      query: 'Formula 1 OR F1',
    },
    {
      name: 'tennis',
      query: 'ATP OR WTA OR tennis',
    },
    {
      name: 'motorsport',
      query: 'MotoGP OR motorsport',
    },
    {
      name: 'combat-sports',
      query: 'UFC OR MMA',
    },
  ];

  constructor(private readonly config: ConfigService) {}

  async fetchLatest(
    kind: 'morning' | 'evening',
    timezone: string,
  ): Promise<SportsNewsSourceResult> {
    const customEndpoint = this.config
      .get<string>('SPORTS_NEWS_SOURCE_URL')
      ?.trim();

    const collected: SportsNewsSource[] = [];
    const providers: string[] = [];

    if (customEndpoint) {
      try {
        const custom = await this.fetchCustomJson(
          customEndpoint,
          kind,
          timezone,
        );

        collected.push(...custom.sources);
        providers.push(custom.provider);
      } catch (error) {
        this.logger.warn(
          `Custom sports-news provider failed: ${this.errorMessage(error)}`,
        );
      }
    }

    const rssResults = await Promise.allSettled(
      this.feeds.map((feed) => this.fetchGoogleNewsFeed(feed)),
    );

    for (let index = 0; index < rssResults.length; index += 1) {
      const result = rssResults[index];
      const feed = this.feeds[index];

      if (result.status === 'fulfilled') {
        collected.push(...result.value);
      } else {
        this.logger.warn(
          `Sports feed ${feed.name} failed: ${this.errorMessage(
            result.reason,
          )}`,
        );
      }
    }

    if (rssResults.some((result) => result.status === 'fulfilled')) {
      providers.push('Google News RSS');
    }

    const sources = this.deduplicate(collected).slice(0, 80);

    if (!sources.length) {
      throw new ServiceUnavailableException(
        'No usable sports-news sources were available. Refusing to invent sports news.',
      );
    }

    return {
      sources,
      provider: providers.join(' + ') || 'sports-news-source-v2',
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchGoogleNewsFeed(
    feed: FeedDefinition,
  ): Promise<SportsNewsSource[]> {
    const url = new URL('https://news.google.com/rss/search');

    url.searchParams.set('q', `(${feed.query}) when:1d`);
    url.searchParams.set('hl', 'en-MY');
    url.searchParams.set('gl', 'MY');
    url.searchParams.set('ceid', 'MY:en');

    const response = await fetch(url, {
      headers: {
        accept:
          'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'user-agent': 'AtlasMarketingOS/1.0 SportsNewsBot',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Google News RSS returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    const parsed = this.parser.parse(xml) as Record<string, unknown>;

    return this.extractRssItems(parsed)
      .map((item) => this.normalizeRssItem(item))
      .filter((item): item is SportsNewsSource => Boolean(item));
  }

  private extractRssItems(
    parsed: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const rss = this.object(parsed.rss);
    const channel = this.object(rss?.channel);
    const rawItems = channel?.item;

    if (!rawItems) {
      return [];
    }

    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private normalizeRssItem(
    item: Record<string, unknown>,
  ): SportsNewsSource | null {
    const title = this.text(item.title);
    const url = this.text(item.link);
    const publishedAt = this.normalizeDate(this.text(item.pubDate));

    if (!title || !url) {
      return null;
    }

    const source = this.object(item.source);

    return {
      title,
      url,
      publishedAt,
      sourceName:
        this.text(source?.['#text']) ?? this.text(item.source) ?? 'Google News',
    };
  }

  private async fetchCustomJson(
    endpoint: string,
    kind: 'morning' | 'evening',
    timezone: string,
  ): Promise<SportsNewsSourceResult> {
    const url = new URL(endpoint);

    url.searchParams.set('edition', kind);
    url.searchParams.set('timezone', timezone);
    url.searchParams.set('limit', '30');

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Sports news source returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const rows = this.extractRows(payload);

    const sources = rows
      .map((row) => this.normalize(row))
      .filter((row): row is SportsNewsSource => Boolean(row));

    if (!sources.length) {
      throw new Error('Custom sports news source returned no usable articles.');
    }

    return {
      sources,
      provider: url.hostname,
      fetchedAt: new Date().toISOString(),
    };
  }

  private deduplicate(sources: SportsNewsSource[]): SportsNewsSource[] {
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const result: SportsNewsSource[] = [];

    for (const source of sources) {
      const urlKey = source.url?.trim().toLowerCase();
      const titleKey = source.title.trim().toLowerCase().replace(/\s+/g, ' ');

      if (urlKey && seenUrls.has(urlKey)) {
        continue;
      }

      if (seenTitles.has(titleKey)) {
        continue;
      }

      if (urlKey) {
        seenUrls.add(urlKey);
      }

      seenTitles.add(titleKey);
      result.push(source);
    }

    return result;
  }

  private extractRows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      const object = payload as Record<string, unknown>;

      for (const key of ['articles', 'results', 'data', 'items']) {
        if (Array.isArray(object[key])) {
          return object[key] as unknown[];
        }
      }
    }

    return [];
  }

  private normalize(value: unknown): SportsNewsSource | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const row = value as Record<string, unknown>;

    const title = this.text(row.title) ?? this.text(row.headline);

    if (!title) {
      return null;
    }

    return {
      title,
      url: this.text(row.url) ?? this.text(row.link),
      publishedAt: this.normalizeDate(
        this.text(row.publishedAt) ??
          this.text(row.published_at) ??
          this.text(row.published) ??
          this.text(row.date),
      ),
      sourceName:
        this.text(row.sourceName) ??
        this.text(row.source_name) ??
        this.text(row.source),
    };
  }

  private normalizeDate(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toISOString();
  }

  private object(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private text(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
