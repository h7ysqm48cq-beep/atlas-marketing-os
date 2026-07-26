import { Injectable } from '@nestjs/common';

export type QualityContent = {
  facebook: string;
  telegram: string;
  reels: string;
  image: string;
};

export type UnifiedQualityResult = {
  content: QualityContent;
  qualityGate: {
    passed: boolean;
    revised: boolean;
    overallScore: number;
    brandFitScore: number;
    platformFitScore: number;
    clarityScore: number;
    engagementScore: number;
    safetyScore: number;
    issues: string[];
    improvements: string[];
    reviewer: 'AI' | 'FALLBACK';
  };
  factualGuard: {
    passed: boolean;
    revised: boolean;
    factualRiskScore: number;
    entityRiskScore: number;
    promotionalRiskScore: number;
    detectedIssues: string[];
    corrections: string[];
    reviewer: 'AI' | 'FALLBACK';
  };
};

@Injectable()
export class ContentQualityService {
  async inspect(input: {
    topic: string;
    style: string;
    language: string;
    brandName: string;
    brandAliases: string[];
    brandVoice: string;
    brandRules: string[];
    forbiddenWords: string[];
    content: QualityContent;
  }): Promise<UnifiedQualityResult> {
    const original = this.cleanContent(input.content);

    const issues: string[] = [];
    const corrections: string[] = [];
    const improvements: string[] = [];

    const forbiddenMatches = this.findMatches(
      original,
      input.forbiddenWords,
    );

    const promotionalTerms = [
      'guaranteed win',
      'guaranteed profit',
      'risk-free profit',
      'instant profit',
      '稳赚',
      '稳胜',
      '稳赚不赔',
      '100%赢钱',
      '包赢',
      '必胜',
      '无风险获利',
    ];

    const promotionalMatches = this.findMatches(
      original,
      promotionalTerms,
    );

    let revisedContent = { ...original };

    const termsToRemove = Array.from(
      new Set([
        ...forbiddenMatches,
        ...promotionalMatches,
      ]),
    );

    if (termsToRemove.length > 0) {
      revisedContent = this.removeTerms(
        revisedContent,
        termsToRemove,
      );

      for (const term of termsToRemove) {
        corrections.push(
          `Removed restricted phrase: ${term}`,
        );
      }
    }

    if (forbiddenMatches.length > 0) {
      issues.push(
        `Restricted wording detected: ${forbiddenMatches.join(', ')}`,
      );
    }

    if (promotionalMatches.length > 0) {
      issues.push(
        `Promotional-risk wording detected: ${promotionalMatches.join(', ')}`,
      );
    }

    const combined = Object.values(revisedContent).join('\n');

    const clarityScore = this.scoreClarity(combined);
    const engagementScore = this.scoreEngagement(
      revisedContent,
    );
    const brandFitScore = this.scoreBrandFit(
      combined,
      input.brandAliases,
      input.brandRules,
    );
    const platformFitScore = this.scorePlatformFit(
      revisedContent,
    );

    const factualRiskScore =
      this.detectUnsupportedFacts(combined);

    const entityRiskScore =
      this.detectEntityRisk(
        combined,
        input.brandAliases,
      );

    const promotionalRiskScore = Math.min(
      100,
      promotionalMatches.length * 25 +
        forbiddenMatches.length * 30,
    );

    const safetyScore = Math.max(
      0,
      100 -
        promotionalRiskScore -
        Math.round(factualRiskScore / 2),
    );

    if (clarityScore < 80) {
      improvements.push(
        'Shorten long sentences and remove repetitive wording.',
      );
    }

    if (engagementScore < 80) {
      improvements.push(
        'Add one natural discussion question or clear audience prompt.',
      );
    }

    if (brandFitScore < 80) {
      improvements.push(
        'Strengthen alignment with the configured brand voice and rules.',
      );
    }

    const overallScore = Math.round(
      (
        clarityScore +
        engagementScore +
        brandFitScore +
        platformFitScore +
        safetyScore
      ) / 5,
    );

    const revised =
      JSON.stringify(original) !==
      JSON.stringify(revisedContent);

    const passed =
      forbiddenMatches.length === 0 &&
      promotionalMatches.length === 0 &&
      factualRiskScore < 50;

    return {
      content: revisedContent,
      qualityGate: {
        passed: passed || revised,
        revised,
        overallScore,
        brandFitScore,
        platformFitScore,
        clarityScore,
        engagementScore,
        safetyScore,
        issues,
        improvements,
        reviewer: 'FALLBACK',
      },
      factualGuard: {
        passed: factualRiskScore < 50,
        revised,
        factualRiskScore,
        entityRiskScore,
        promotionalRiskScore,
        detectedIssues: issues,
        corrections,
        reviewer: 'FALLBACK',
      },
    };
  }

  private cleanContent(
    content: QualityContent,
  ): QualityContent {
    return {
      facebook: this.cleanText(content.facebook),
      telegram: this.cleanText(content.telegram),
      reels: this.cleanText(content.reels),
      image: this.cleanText(content.image),
    };
  }

  private cleanText(value: string): string {
    return (value || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private findMatches(
    content: QualityContent,
    terms: string[],
  ): string[] {
    const text = Object.values(content)
      .join('\n')
      .toLowerCase();

    return Array.from(
      new Set(
        terms
          .map((term) => term?.trim())
          .filter((term): term is string =>
            Boolean(term),
          )
          .filter((term) =>
            text.includes(term.toLowerCase()),
          ),
      ),
    );
  }

  private removeTerms(
    content: QualityContent,
    terms: string[],
  ): QualityContent {
    const clean = (value: string) => {
      let output = value;

      for (const term of terms) {
        output = output.replace(
          new RegExp(
            this.escapeRegExp(term),
            'giu',
          ),
          '',
        );
      }

      return this.cleanText(output);
    };

    return {
      facebook: clean(content.facebook),
      telegram: clean(content.telegram),
      reels: clean(content.reels),
      image: clean(content.image),
    };
  }

  private scoreClarity(text: string): number {
    if (!text.trim()) return 20;

    let score = 95;

    const longSentences = text
      .split(/[。！？.!?]/)
      .filter((sentence) => sentence.length > 160)
      .length;

    score -= Math.min(25, longSentences * 5);

    const repeatedSpaces =
      (text.match(/\s{3,}/g) || []).length;

    score -= Math.min(10, repeatedSpaces * 2);

    return this.clamp(score);
  }

  private scoreEngagement(
    content: QualityContent,
  ): number {
    const text = [
      content.facebook,
      content.telegram,
      content.reels,
    ].join('\n');

    let score = 70;

    if (/[？?]/.test(text)) score += 12;

    if (
      /评论|留言|分享|告诉我们|你还记得|加入讨论|comment|share|tell us/i.test(
        text,
      )
    ) {
      score += 10;
    }

    if (text.length >= 180) score += 5;

    return this.clamp(score);
  }

  private scoreBrandFit(
    text: string,
    aliases: string[],
    rules: string[],
  ): number {
    let score = 82;

    const lower = text.toLowerCase();

    if (
      aliases.some((alias) =>
        lower.includes(alias.toLowerCase()),
      )
    ) {
      score += 8;
    }

    if (rules.length > 0) score += 5;

    return this.clamp(score);
  }

  private scorePlatformFit(
    content: QualityContent,
  ): number {
    let score = 90;

    if (content.facebook.length > 3000) {
      score -= 10;
    }

    if (content.telegram.length > 1800) {
      score -= 10;
    }

    if (!content.reels.trim()) {
      score -= 20;
    }

    if (!content.image.trim()) {
      score -= 20;
    }

    return this.clamp(score);
  }

  private detectUnsupportedFacts(
    text: string,
  ): number {
    const riskyPatterns = [
      /\b\d{1,3}%\b/g,
      /\bRM\s?\d[\d,.]*/gi,
      /\b\d{4}\b/g,
      /第一|最大|唯一|官方|全球领先/g,
      /confirmed|official|number one|largest/gi,
    ];

    const count = riskyPatterns.reduce(
      (total, pattern) =>
        total + (text.match(pattern) || []).length,
      0,
    );

    return Math.min(100, count * 8);
  }

  private detectEntityRisk(
    text: string,
    aliases: string[],
  ): number {
    const lower = text.toLowerCase();

    const knownAliasPresent = aliases.some(
      (alias) =>
        alias.trim() &&
        lower.includes(alias.toLowerCase()),
    );

    return knownAliasPresent ? 0 : 5;
  }

  private escapeRegExp(value: string): string {
    return value.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
  }

  private clamp(value: number): number {
    return Math.max(
      0,
      Math.min(100, Math.round(value)),
    );
  }
}
