import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ConversationRecallService {
  constructor(private readonly prisma: PrismaService) {}

  private extractKeywords(query: string): string[] {
    const normalized = query.replace(/\s+/g, ' ').trim();

    if (!normalized) {
      return [];
    }

    const keywords = new Set<string>();

    /*
     * Preserve explicit M-series names as high-value phrases.
     * Examples:
     * M MARKET
     * M CONSUMER
     * M BRAND LAB
     */
    const mSeriesMatches =
      normalized.match(
        /\bM\s+(?:LEADERS|BUSINESS|TECH|BRAND\s+LAB|CONSUMER|MARKET|NEXT|STORY)\b/gi,
      ) ?? [];

    for (const match of mSeriesMatches) {
      keywords.add(match.replace(/\s+/g, ' ').trim());
    }

    /*
     * Useful Latin / alphanumeric terms.
     */
    const latinTokens = normalized.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];

    for (const token of latinTokens) {
      const upper = token.toUpperCase();

      if (['THE', 'AND', 'WHAT', 'WAS', 'WERE', 'BEFORE'].includes(upper)) {
        continue;
      }

      keywords.add(token);
    }

    /*
     * High-signal Chinese phrases used by Atlas recall.
     * This is deliberately conservative:
     * we do not split every Chinese character into tokens.
     */
    const chineseSignals = [
      '满贯门',
      '港剧',
      '怀旧',
      '消费者心理',
      '消费心理',
      '视觉风格',
      '图片',
      '栏目安排',
      '金融',
      '经济',
      '市场变化',
      '科技',
      '创新',
      '商业模式',
      '品牌设计',
    ];

    for (const signal of chineseSignals) {
      if (normalized.includes(signal)) {
        keywords.add(signal);
      }
    }

    return [...keywords].filter((keyword) => keyword.length >= 2).slice(0, 8);
  }

  async search(input: {
    query: string;
    limit?: number;
    excludeConversationId?: string;
  }) {
    const keywords = this.extractKeywords(input.query);

    if (!keywords.length) {
      return [];
    }

    const limit = Math.min(Math.max(input.limit || 5, 1), 10);

    const conversations = await this.prisma.copilotConversation.findMany({
      where: {
        isArchived: false,

        id: input.excludeConversationId
          ? {
              not: input.excludeConversationId,
            }
          : undefined,

        OR: keywords.flatMap((keyword) => [
          {
            title: {
              contains: keyword,
              mode: 'insensitive' as const,
            },
          },
          {
            messages: {
              some: {
                content: {
                  contains: keyword,
                  mode: 'insensitive' as const,
                },
              },
            },
          },
        ]),
      },

      select: {
        id: true,
        title: true,
        mode: true,
        updatedAt: true,

        messages: {
          select: {
            role: true,
            content: true,
          },

          orderBy: {
            createdAt: 'desc',
          },

          take: 8,
        },
      },

      orderBy: {
        updatedAt: 'desc',
      },

      /*
       * Fetch a wider candidate pool before ranking.
       */
      take: Math.max(limit * 4, 20),
    });

    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());

    return conversations
      .map((conversation) => {
        const searchableText = [
          conversation.title,
          ...conversation.messages.map((message) => message.content),
        ]
          .join('\n')
          .toLowerCase();

        const matchedKeywords = normalizedKeywords.filter((keyword) =>
          searchableText.includes(keyword),
        );

        /*
         * Exact M-series phrases carry more weight than
         * generic supporting terms.
         */
        const keywordScore = matchedKeywords.reduce((score, keyword) => {
          const isMSeries =
            /^m\s+(leaders|business|tech|brand\s+lab|consumer|market|next|story)$/i.test(
              keyword,
            );

          return score + (isMSeries ? 3 : 1);
        }, 0);

        return {
          id: conversation.id,
          title: conversation.title,
          mode: conversation.mode,
          updatedAt: conversation.updatedAt,

          messages: conversation.messages.reverse().slice(-6),

          matchedKeywords,
          keywordScore,
        };
      })
      .sort((a, b) => {
        if (b.keywordScore !== a.keywordScore) {
          return b.keywordScore - a.keywordScore;
        }

        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      })
      .slice(0, limit);
  }
}
