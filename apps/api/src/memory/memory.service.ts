import { Injectable } from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { ContentStatus } from '../generated/prisma/client';

type AnalysisData = {
  viralScore?: number;
  discussionScore?: number;
  shareabilityScore?: number;
  brandFitScore?: number;
  bestPostingTime?: string;
};

export type MemorySummary = {
  brandId: string;
  brandName: string;
  totalGenerations: number;
  approvedCount: number;
  publishedCount: number;
  learningSampleSize: number;
  preferredStyle: string | null;
  preferredLanguage: string | null;
  bestPlatform: string | null;
  bestPostingTime: string | null;
  averageScores: {
    viral: number;
    discussion: number;
    shareability: number;
    brandFit: number;
  };
  confidence: number;
  recommendations: string[];
};

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
  ) {}

  async summary(): Promise<MemorySummary> {
    const brand = await this.brandsService.getActiveBrand();

    const records = await this.prisma.generationHistory.findMany({
      where: { brandId: brand.id },
      select: {
        style: true,
        language: true,
        platforms: true,
        analysis: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const learningRecords = records.filter(
      (record) =>
        record.status === ContentStatus.APPROVED ||
        record.status === ContentStatus.PUBLISHED,
    );

    // Use approved/published content first.
    // Fall back to all generations while Memory is still new.
    const sample = learningRecords.length > 0 ? learningRecords : records;

    const preferredStyle = this.mode(
      sample.map((record) => record.style).filter(Boolean),
    );

    const preferredLanguage = this.mode(
      sample.map((record) => record.language).filter(Boolean),
    );

    const platformValues = sample.flatMap((record) => record.platforms);
    const bestPlatform = this.mode(platformValues);

    const analyses = sample.map(
      (record) => (record.analysis || {}) as AnalysisData,
    );

    const postingTimes = analyses
      .map((analysis) => analysis.bestPostingTime)
      .filter((value): value is string => Boolean(value));

    const averages = {
      viral: this.average(
        analyses.map((analysis) => analysis.viralScore),
      ),
      discussion: this.average(
        analyses.map((analysis) => analysis.discussionScore),
      ),
      shareability: this.average(
        analyses.map((analysis) => analysis.shareabilityScore),
      ),
      brandFit: this.average(
        analyses.map((analysis) => analysis.brandFitScore),
      ),
    };

    const approvedCount = records.filter(
      (record) => record.status === ContentStatus.APPROVED,
    ).length;

    const publishedCount = records.filter(
      (record) => record.status === ContentStatus.PUBLISHED,
    ).length;

    const confidence = Math.min(
      100,
      Math.round(
        (learningRecords.length / Math.max(records.length, 1)) * 70 +
          Math.min(learningRecords.length * 5, 30),
      ),
    );

    return {
      brandId: brand.id,
      brandName: brand.name,
      totalGenerations: records.length,
      approvedCount,
      publishedCount,
      learningSampleSize: sample.length,
      preferredStyle,
      preferredLanguage,
      bestPlatform,
      bestPostingTime: this.mode(postingTimes),
      averageScores: averages,
      confidence,
      recommendations: this.buildRecommendations({
        preferredStyle,
        preferredLanguage,
        bestPlatform,
        bestPostingTime: this.mode(postingTimes),
        averages,
        learningRecords: learningRecords.length,
      }),
    };
  }

  async promptContext(): Promise<string> {
    const memory = await this.summary();

    return [
      'ATLAS MEMORY',
      `Learning sample: ${memory.learningSampleSize} content records`,
      `Preferred style: ${memory.preferredStyle || 'Not learned yet'}`,
      `Preferred language: ${memory.preferredLanguage || 'Not learned yet'}`,
      `Best platform: ${memory.bestPlatform || 'Not learned yet'}`,
      `Best posting time: ${memory.bestPostingTime || 'Not learned yet'}`,
      `Average viral score: ${memory.averageScores.viral}`,
      `Average discussion score: ${memory.averageScores.discussion}`,
      `Average shareability score: ${memory.averageScores.shareability}`,
      `Average brand-fit score: ${memory.averageScores.brandFit}`,
      '',
      'MEMORY GUIDANCE',
      memory.recommendations.length
        ? memory.recommendations.map((item) => `- ${item}`).join('\n')
        : '- Insufficient approved content. Follow Brand Brain defaults.',
      '',
      'Use Memory as supporting guidance, not as a reason to ignore the current task or campaign context.',
    ].join('\n');
  }

  private mode(values: string[]): string | null {
    if (values.length === 0) return null;

    const counts = new Map<string, number>();

    for (const value of values) {
      const normalized = value.trim();
      if (!normalized) continue;

      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    return (
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
      null
    );
  }

  private average(values: Array<number | undefined>): number {
    const valid = values.filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );

    if (valid.length === 0) return 0;

    return Math.round(
      valid.reduce((sum, value) => sum + value, 0) / valid.length,
    );
  }

  private buildRecommendations(input: {
    preferredStyle: string | null;
    preferredLanguage: string | null;
    bestPlatform: string | null;
    bestPostingTime: string | null;
    averages: {
      viral: number;
      discussion: number;
      shareability: number;
      brandFit: number;
    };
    learningRecords: number;
  }): string[] {
    if (input.learningRecords === 0) {
      return [
        'Approve or publish more content to strengthen Atlas Memory.',
        'Current recommendations are based on generation history only.',
      ];
    }

    const recommendations: string[] = [];

    if (input.preferredStyle) {
      recommendations.push(
        `Use ${input.preferredStyle} as the starting style when it fits the topic.`,
      );
    }

    if (input.bestPlatform) {
      recommendations.push(
        `Prioritise ${input.bestPlatform} when campaign objectives allow.`,
      );
    }

    if (input.bestPostingTime) {
      recommendations.push(
        `Consider ${input.bestPostingTime} as the initial posting window.`,
      );
    }

    if (input.averages.discussion < 80) {
      recommendations.push(
        'Use a clearer and easier-to-answer discussion question.',
      );
    }

    if (input.averages.shareability < 80) {
      recommendations.push(
        'Make the opening more relatable and easier to forward.',
      );
    }

    if (input.averages.brandFit < 85) {
      recommendations.push(
        'Apply Brand Brain voice and visual direction more consistently.',
      );
    }

    return recommendations;
  }
}
