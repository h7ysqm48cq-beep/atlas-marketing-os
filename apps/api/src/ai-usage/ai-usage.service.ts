import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async summary(days = 30) {
    const safeDays = this.normalizeDays(days);
    const since = this.getSinceDate(safeDays);

    const [
      overall,
      models,
      today,
      last24Hours,
    ] = await Promise.all([
      this.prisma.aiUsage.aggregate({
        where: {
          createdAt: {
            gte: since,
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          promptTokens: true,
          cachedInputTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          estimatedCostMyr: true,
          durationMs: true,
        },
        _avg: {
          durationMs: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
        },
      }),

      this.prisma.aiUsage.groupBy({
        by: ['model'],
        where: {
          createdAt: {
            gte: since,
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          promptTokens: true,
          cachedInputTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          estimatedCostMyr: true,
          durationMs: true,
        },
        _avg: {
          durationMs: true,
        },
        orderBy: {
          _sum: {
            estimatedCostUsd: 'desc',
          },
        },
      }),

      this.prisma.aiUsage.aggregate({
        where: {
          createdAt: {
            gte: this.startOfToday(),
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          promptTokens: true,
          cachedInputTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          estimatedCostMyr: true,
          durationMs: true,
        },
        _avg: {
          durationMs: true,
        },
      }),

      this.prisma.aiUsage.aggregate({
        where: {
          createdAt: {
            gte: new Date(
              Date.now() - 24 * 60 * 60 * 1000,
            ),
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          promptTokens: true,
          cachedInputTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          estimatedCostMyr: true,
          durationMs: true,
        },
        _avg: {
          durationMs: true,
        },
      }),
    ]);

    const calls =
      overall._count._all;

    const totalDurationMs =
      overall._sum.durationMs ?? 0;

    const totalCostMyr =
      overall._sum.estimatedCostMyr ?? 0;

    const totalCostUsd =
      overall._sum.estimatedCostUsd ?? 0;

    const averageDailyCostMyr =
      totalCostMyr / safeDays;

    const averageDailyCostUsd =
      totalCostUsd / safeDays;

    const projectedMonthlyCostMyr =
      averageDailyCostMyr * 30;

    const projectedMonthlyCostUsd =
      averageDailyCostUsd * 30;

    return {
      period: {
        days: safeDays,
        from: since,
        to: new Date(),
      },

      today: {
        calls:
          today._count._all,
        promptTokens:
          today._sum.promptTokens ?? 0,
        cachedInputTokens:
          today._sum.cachedInputTokens ?? 0,
        completionTokens:
          today._sum.completionTokens ?? 0,
        totalTokens:
          today._sum.totalTokens ?? 0,
        estimatedCostUsd:
          today._sum.estimatedCostUsd ?? 0,
        estimatedCostMyr:
          today._sum.estimatedCostMyr ?? 0,
        averageDurationMs:
          Math.round(
            today._avg.durationMs ?? 0,
          ),
      },

      last24Hours: {
        calls:
          last24Hours._count._all,
        promptTokens:
          last24Hours._sum.promptTokens ?? 0,
        cachedInputTokens:
          last24Hours._sum.cachedInputTokens ?? 0,
        completionTokens:
          last24Hours._sum.completionTokens ?? 0,
        totalTokens:
          last24Hours._sum.totalTokens ?? 0,
        estimatedCostUsd:
          last24Hours._sum.estimatedCostUsd ?? 0,
        estimatedCostMyr:
          last24Hours._sum.estimatedCostMyr ?? 0,
        averageDurationMs:
          Math.round(
            last24Hours._avg.durationMs ?? 0,
          ),
      },



      totals: {
        calls,
        promptTokens:
          overall._sum.promptTokens ?? 0,
        cachedInputTokens:
          overall._sum.cachedInputTokens ?? 0,
        completionTokens:
          overall._sum.completionTokens ?? 0,
        totalTokens:
          overall._sum.totalTokens ?? 0,
        estimatedCostUsd:
          overall._sum.estimatedCostUsd ?? 0,
        estimatedCostMyr:
          overall._sum.estimatedCostMyr ?? 0,
        totalDurationMs,
        averageDurationMs:
          Math.round(
            overall._avg.durationMs ?? 0,
          ),
        averagePromptTokens:
          Math.round(
            overall._avg.promptTokens ?? 0,
          ),
        averageCompletionTokens:
          Math.round(
            overall._avg.completionTokens ?? 0,
          ),
        averageTotalTokens:
          Math.round(
            overall._avg.totalTokens ?? 0,
          ),
        cacheRatePercent:
          this.calculateCacheRate(
            overall._sum.promptTokens ?? 0,
            overall._sum.cachedInputTokens ?? 0,
          ),
        averageCostPerCallMyr:
          calls > 0
            ? totalCostMyr / calls
            : 0,
        averageCostPerCallUsd:
          calls > 0
            ? totalCostUsd / calls
            : 0,
        averageDailyCostMyr,
        averageDailyCostUsd,
        projectedMonthlyCostMyr,
        projectedMonthlyCostUsd,
      },

      models: models.map(
        (item) => ({
          model: item.model,
          calls:
            item._count._all,
          promptTokens:
            item._sum.promptTokens ?? 0,
          cachedInputTokens:
            item._sum.cachedInputTokens ?? 0,
          completionTokens:
            item._sum.completionTokens ?? 0,
          totalTokens:
            item._sum.totalTokens ?? 0,
          estimatedCostUsd:
            item._sum.estimatedCostUsd ?? 0,
          estimatedCostMyr:
            item._sum.estimatedCostMyr ?? 0,
          totalDurationMs:
            item._sum.durationMs ?? 0,
          averageDurationMs:
            Math.round(
              item._avg.durationMs ?? 0,
            ),
        }),
      ),
    };
  }

  async recent(limit = 20) {
    const safeLimit = Math.min(
      100,
      Math.max(
        1,
        Number(limit) || 20,
      ),
    );

    return this.prisma.aiUsage.findMany({
      take: safeLimit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        history: {
          select: {
            id: true,
            topic: true,
            platforms: true,
            style: true,
            language: true,
            createdAt: true,
            brand: {
              select: {
                id: true,
                name: true,
              },
            },
            campaign: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async trend(days = 30) {
    const safeDays = this.normalizeDays(days);
    const since = this.getSinceDate(safeDays);

    const records =
      await this.prisma.aiUsage.findMany({
        where: {
          createdAt: {
            gte: since,
          },
        },
        select: {
          createdAt: true,
          promptTokens: true,
          cachedInputTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          estimatedCostMyr: true,
          durationMs: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

    const grouped =
      new Map<
        string,
        {
          date: string;
          calls: number;
          promptTokens: number;
          cachedInputTokens: number;
          completionTokens: number;
          totalTokens: number;
          estimatedCostUsd: number;
          estimatedCostMyr: number;
          totalDurationMs: number;
        }
      >();

    for (const record of records) {
      const date =
        record.createdAt
          .toISOString()
          .slice(0, 10);

      const current =
        grouped.get(date) ?? {
          date,
          calls: 0,
          promptTokens: 0,
          cachedInputTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          estimatedCostMyr: 0,
          totalDurationMs: 0,
        };

      current.calls += 1;
      current.promptTokens +=
        record.promptTokens;
      current.cachedInputTokens +=
        record.cachedInputTokens;
      current.completionTokens +=
        record.completionTokens;
      current.totalTokens +=
        record.totalTokens;
      current.estimatedCostUsd +=
        record.estimatedCostUsd;
      current.estimatedCostMyr +=
        record.estimatedCostMyr;
      current.totalDurationMs +=
        record.durationMs;

      grouped.set(
        date,
        current,
      );
    }

    return Array.from(
      grouped.values(),
    ).map((item) => ({
      ...item,
      averageDurationMs:
        item.calls > 0
          ? Math.round(
              item.totalDurationMs /
                item.calls,
            )
          : 0,
    }));
  }

  private normalizeDays(
    days: number,
  ): number {
    return Math.min(
      365,
      Math.max(
        1,
        Number(days) || 30,
      ),
    );
  }

  private getSinceDate(
    days: number,
  ): Date {
    const date = new Date();

    date.setDate(
      date.getDate() - days + 1,
    );

    date.setHours(
      0,
      0,
      0,
      0,
    );

    return date;
  }

  private startOfToday(): Date {
    const date = new Date();

    date.setHours(
      0,
      0,
      0,
      0,
    );

    return date;
  }

  private calculateCacheRate(
    promptTokens: number,
    cachedTokens: number,
  ): number {
    if (promptTokens <= 0) {
      return 0;
    }

    return Number(
      (
        cachedTokens /
        promptTokens *
        100
      ).toFixed(2),
    );
  }
}
