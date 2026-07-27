import { Injectable } from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { MemoryFactsService } from '../memory/memory-facts.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { HistoryService } from '../history/history.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly brands: BrandsService,
    private readonly memoryFacts: MemoryFactsService,
    private readonly knowledgeService: KnowledgeService,
    private readonly historyService: HistoryService,
    private readonly aiUsageService: AiUsageService,
  ) {}

  async summary() {
    const brand = await this.brands.getActiveBrand();

    const confirmedFacts = await this.memoryFacts.findAll({
      status: 'CONFIRMED',
    });

    const candidateFacts = await this.memoryFacts.findAll({
      status: 'CANDIDATE',
    });

    const rejectedFacts = await this.memoryFacts.findAll({
      status: 'REJECTED',
    });

    const totalFacts =
      confirmedFacts.length +
      candidateFacts.length +
      rejectedFacts.length;

    const allFacts = [
      ...confirmedFacts,
      ...candidateFacts,
      ...rejectedFacts,
    ];

    const averageConfidence = allFacts.length
      ? Math.round(
          allFacts.reduce(
            (sum, fact) => sum + fact.confidence,
            0,
          ) / allFacts.length,
        )
      : 0;

    const knowledgeDocuments =
      await this.knowledgeService.findAll();

    const knowledgeCategories = new Set(
      knowledgeDocuments
        .map((document) => document.category.trim())
        .filter(Boolean),
    );

    const totalKnowledgeUsage =
      knowledgeDocuments.reduce(
        (total, document) =>
          total + document.usageCount,
        0,
      );

    const latestKnowledgeDocument =
      knowledgeDocuments[0] ?? null;

    const historyRecords =
      await this.historyService.list();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const historyToday = historyRecords.filter(
      (record) =>
        record.createdAt.getTime() >=
        todayStart.getTime(),
    );

    const favoriteHistory = historyRecords.filter(
      (record) => record.isFavorite,
    );

    const draftHistory = historyRecords.filter(
      (record) => record.status === 'DRAFT',
    );

    const publishedHistory = historyRecords.filter(
      (record) => record.status === 'PUBLISHED',
    );

    const latestHistory =
      historyRecords[0] ?? null;

    const aiUsageSummary =
      await this.aiUsageService.summary(30);

    return {
      status: 'building',
      brand: {
        id: brand.id,
        name: brand.name,
        country: brand.country,
        primaryLanguage: brand.primaryLanguage,
        targetAudience: brand.targetAudience,
        brandVoice: brand.brandVoice,
        visualStyle: brand.visualStyle,
      },
      memory: {
        confirmed: confirmedFacts.length,
        candidate: candidateFacts.length,
        rejected: rejectedFacts.length,
        total: totalFacts,
        averageConfidence,
      },
      knowledge: {
        documents: knowledgeDocuments.length,
        categories: knowledgeCategories.size,
        totalUsage: totalKnowledgeUsage,
        latestUpdatedAt:
          latestKnowledgeDocument?.updatedAt ?? null,
      },
      history: {
        total: historyRecords.length,
        today: historyToday.length,
        favorites: favoriteHistory.length,
        draft: draftHistory.length,
        published: publishedHistory.length,
        latestCreatedAt:
          latestHistory?.createdAt ?? null,
      },
      aiUsage: {
        periodDays: aiUsageSummary.period.days,
        totalRequests:
          aiUsageSummary.totals.calls,
        todayRequests:
          aiUsageSummary.today.calls,
        totalTokens:
          aiUsageSummary.totals.totalTokens,
        todayTokens:
          aiUsageSummary.today.totalTokens,
        totalCostMyr:
          aiUsageSummary.totals.estimatedCostMyr,
        todayCostMyr:
          aiUsageSummary.today.estimatedCostMyr,
        averageCostPerCallMyr:
          aiUsageSummary.totals.averageCostPerCallMyr,
        projectedMonthlyCostMyr:
          aiUsageSummary.totals.projectedMonthlyCostMyr,
        averageDurationMs:
          aiUsageSummary.totals.averageDurationMs,
        modelsUsed:
          aiUsageSummary.models.length,
      },
    };
  }
}
