import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SportsNewsSource } from '../automation/sports-news-source-validator.service';

export type SportsNewsSourceResult = { sources: SportsNewsSource[]; provider: string; fetchedAt: string };

@Injectable()
export class SportsNewsSourceService {
  constructor(private readonly config: ConfigService) {}

  async fetchLatest(kind: 'morning' | 'evening', timezone: string): Promise<SportsNewsSourceResult> {
    const endpoint = this.config.get<string>('SPORTS_NEWS_SOURCE_URL')?.trim();
    if (!endpoint) {
      throw new ServiceUnavailableException('SPORTS_NEWS_SOURCE_URL is not configured. Refusing to invent sports news.');
    }

    const url = new URL(endpoint);
    url.searchParams.set('edition', kind);
    url.searchParams.set('timezone', timezone);
    url.searchParams.set('limit', '30');

    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new ServiceUnavailableException(`Sports news source returned HTTP ${response.status}.`);
    const payload = await response.json() as unknown;
    const rows = this.extractRows(payload);
    const sources = rows.map(row => this.normalize(row)).filter((row): row is SportsNewsSource => Boolean(row));
    if (!sources.length) throw new ServiceUnavailableException('Sports news source returned no usable articles.');
    return { sources, provider: url.hostname, fetchedAt: new Date().toISOString() };
  }

  private extractRows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      for (const key of ['articles', 'results', 'data', 'items']) if (Array.isArray(p[key])) return p[key] as unknown[];
    }
    return [];
  }

  private normalize(value: unknown): SportsNewsSource | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const title = this.text(row.title) ?? this.text(row.headline);
    if (!title) return null;
    return {
      title,
      url: this.text(row.url) ?? this.text(row.link),
      publishedAt: this.text(row.publishedAt) ?? this.text(row.published_at) ?? this.text(row.published) ?? this.text(row.date),
      sourceName: this.text(row.sourceName) ?? this.text(row.source_name) ?? this.text(row.source),
    };
  }

  private text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
}
