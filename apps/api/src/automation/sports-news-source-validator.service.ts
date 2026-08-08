import { BadRequestException, Injectable } from '@nestjs/common';

export type SportsNewsSource = { title: string; url?: string | null; publishedAt?: string | Date | null; sourceName?: string | null };
export type SportsNewsFreshnessRules = { timezone: string; sameDaySourcesOnly: boolean; maxSourceAgeHours: number; requirePublishedAt: boolean; requireSourceUrl: boolean; minimumSources: number; freshnessFallbackEnabled: boolean };

@Injectable()
export class SportsNewsSourceValidatorService {
  validate(sources: SportsNewsSource[], rules: SportsNewsFreshnessRules, now = new Date()) {
    const accepted: SportsNewsSource[] = []; const rejected: Array<{ source: SportsNewsSource; reason: string }> = [];
    for (const source of sources) {
      const reason = this.rejectionReason(source, rules, now);
      if (reason) rejected.push({ source, reason }); else accepted.push(source);
    }
    const enoughSources = accepted.length >= Math.max(1, rules.minimumSources);
    if (!enoughSources && !rules.freshnessFallbackEnabled) {
      throw new BadRequestException(`Fresh sports-news validation failed: ${accepted.length} valid source(s), minimum ${rules.minimumSources}. Refusing to publish stale or unverifiable news.`);
    }
    return { accepted, rejected, enoughSources, fallbackAllowed: !enoughSources && rules.freshnessFallbackEnabled, checkedAt: now.toISOString() };
  }

  private rejectionReason(source: SportsNewsSource, rules: SportsNewsFreshnessRules, now: Date) {
    if (rules.requireSourceUrl && !source.url?.trim()) return 'missing_source_url';
    if (rules.requirePublishedAt && !source.publishedAt) return 'missing_published_at';
    if (!source.publishedAt) return null;
    const published = new Date(source.publishedAt); if (Number.isNaN(published.getTime())) return 'invalid_published_at';
    const ageHours = (now.getTime() - published.getTime()) / 3_600_000;
    if (ageHours < -0.25) return 'published_in_future';
    if (ageHours > rules.maxSourceAgeHours) return 'source_too_old';
    if (rules.sameDaySourcesOnly && this.localDate(published, rules.timezone) !== this.localDate(now, rules.timezone)) return 'not_same_local_day';
    return null;
  }

  private localDate(value: Date, timezone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
}
