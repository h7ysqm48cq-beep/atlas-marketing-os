import { Injectable } from '@nestjs/common';
import { ConversationRecallContextBuilder } from './conversation-recall-context.builder';

type KeywordRecall = {
  id: string;
  title: string;
  mode: string;
  updatedAt: Date;
  messages: {
    role: string;
    content: string;
  }[];
  matchedKeywords?: string[];
  keywordScore?: number;
};

type SemanticRecall = {
  conversationId: string;
  title: string;
  mode: string;
  content: string;
  score: number;
  updatedAt: Date;
};

type FusedRecall = {
  conversationId: string;
  title: string;
  mode: string;
  content: string;
  semanticScore: number | null;
  keywordScore: number;
  matchedKeywords: string[];
  matchedByKeyword: boolean;
  entityScore: number;
  updatedAt: Date;
};

@Injectable()
export class ConversationRecallFusionService {
  constructor(
    private readonly contextBuilder: ConversationRecallContextBuilder,
  ) {}

  fuse(
    keywordResults: KeywordRecall[],
    semanticResults: SemanticRecall[],
    options?: {
      query?: string;
      limit?: number;
      maxCharsPerConversation?: number;
      maxTotalChars?: number;
    },
  ) {
    const query = this.normalize(options?.query || '');

    const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);

    const maxCharsPerConversation = options?.maxCharsPerConversation ?? 1500;

    const maxTotalChars = options?.maxTotalChars ?? 6000;

    const requestedEntities = this.extractRequestedEntities(query);

    const fused = new Map<string, FusedRecall>();

    for (const item of semanticResults) {
      const content =
        this.contextBuilder.buildFromEmbeddedContent(item.content) ||
        item.content;

      fused.set(item.conversationId, {
        conversationId: item.conversationId,
        title: item.title,
        mode: item.mode,
        content,
        semanticScore: item.score,
        keywordScore: 0,
        matchedKeywords: [],
        matchedByKeyword: false,
        entityScore: this.entityScore(
          requestedEntities,
          `${item.title}\n${content}`,
        ),
        updatedAt: item.updatedAt,
      });
    }

    for (const item of keywordResults) {
      const selectedMessages = this.contextBuilder.buildMessages(item.messages);

      const content = [
        `Conversation: ${item.title}`,
        `Mode: ${item.mode}`,
        '',
        selectedMessages,
      ]
        .filter(Boolean)
        .join('\n');

      const existing = fused.get(item.id);

      if (existing) {
        existing.matchedByKeyword = true;
        existing.keywordScore = item.keywordScore ?? 0;
        existing.matchedKeywords = item.matchedKeywords ?? [];

        existing.entityScore = Math.max(
          existing.entityScore,
          this.entityScore(requestedEntities, `${item.title}\n${content}`),
        );

        /*
         * Keyword retrieval contains fresher raw messages than
         * the stored embedding snapshot in some cases.
         *
         * Prefer it when it carries useful conversation content.
         */
        if (selectedMessages) {
          existing.content = content;
        }

        continue;
      }

      fused.set(item.id, {
        conversationId: item.id,
        title: item.title,
        mode: item.mode,
        content,
        semanticScore: null,
        keywordScore: item.keywordScore ?? 0,
        matchedKeywords: item.matchedKeywords ?? [],
        matchedByKeyword: true,
        entityScore: this.entityScore(
          requestedEntities,
          `${item.title}\n${content}`,
        ),
        updatedAt: item.updatedAt,
      });
    }

    const ranked = [...fused.values()]
      .map((item) => ({
        ...item,
        finalScore: this.finalScore(item, requestedEntities.length > 0),
      }))
      .sort((a, b) => {
        if (b.finalScore !== a.finalScore) {
          return b.finalScore - a.finalScore;
        }

        return b.updatedAt.getTime() - a.updatedAt.getTime();
      })
      .slice(0, limit);

    const sections: string[] = [];

    let usedChars = 0;

    for (const item of ranked) {
      if (usedChars >= maxTotalChars) {
        break;
      }

      const retrieval = [
        item.semanticScore !== null
          ? `semantic ${(item.semanticScore * 100).toFixed(1)}%`
          : null,
        item.keywordScore > 0
          ? `keyword ${item.keywordScore.toFixed(1)}`
          : item.matchedByKeyword
            ? 'keyword match'
            : null,
        item.entityScore > 0 ? `entity ${item.entityScore.toFixed(1)}` : null,
      ]
        .filter(Boolean)
        .join(' + ');

      const header = `[${item.title} | ${retrieval || 'historical match'}]`;

      const remaining = maxTotalChars - usedChars;

      const allowedContent = Math.min(
        maxCharsPerConversation,
        Math.max(remaining - header.length - 2, 0),
      );

      if (allowedContent <= 0) {
        break;
      }

      const section = [header, item.content.slice(0, allowedContent)].join(
        '\n',
      );

      sections.push(section);

      usedChars += section.length + 2;
    }

    if (!sections.length) {
      return 'PREVIOUS CONVERSATION MEMORY: none';
    }

    return [
      'PREVIOUS CONVERSATION MEMORY',
      'Use historical discussions only when relevant.',
      'Memory interpretation rules:',
      '- Current user instructions always have priority.',
      '- Later explicit user corrections override earlier assistant claims.',
      '- Later confirmed decisions override earlier drafts or suggestions.',
      '- Assistant mistakes that were subsequently corrected must not be treated as memory.',
      '- Do not infer a user preference merely because an assistant previously suggested it.',
      '- When the user names a specific M-series property, prioritize memory about that exact property over broadly related marketing discussions.',
      '- Do not merge different M-series properties merely because they share similar themes.',
      '- If the user asks for a complete historical list or schedule, use all supplied relevant memories before concluding that information is missing.',
      '',
      ...sections,
    ]
      .join('\n\n')
      .slice(0, maxTotalChars);
  }

  private finalScore(item: FusedRecall, hasRequestedEntity: boolean): number {
    const semantic = item.semanticScore ?? 0;

    /*
     * Keyword evidence must matter materially.
     *
     * Previously production fusion only added a flat +0.1,
     * discarding the richer keywordScore calculated upstream.
     */
    const keyword = Math.min(item.keywordScore * 0.12, 0.6);

    /*
     * Exact named-property matching is especially important for
     * M-series recall because semantically adjacent properties
     * often discuss similar marketing themes.
     */
    const entity = item.entityScore * 0.35;

    /*
     * If an exact property was requested but this conversation
     * contains none of the requested entities, slightly suppress
     * generic semantic matches.
     */
    const mismatchPenalty =
      hasRequestedEntity && item.entityScore === 0 ? 0.2 : 0;

    return semantic + keyword + entity - mismatchPenalty;
  }

  private extractRequestedEntities(query: string): string[] {
    if (!query) {
      return [];
    }

    const entities = new Set<string>();

    const matches =
      query.match(
        /\bm\s+(?:leaders|business|tech|brand\s+lab|consumer|market|next|story)\b/gi,
      ) ?? [];

    for (const match of matches) {
      entities.add(this.normalize(match));
    }

    return [...entities];
  }

  private entityScore(requestedEntities: string[], content: string): number {
    if (!requestedEntities.length) {
      return 0;
    }

    const normalizedContent = this.normalize(content);

    let matches = 0;

    for (const entity of requestedEntities) {
      if (normalizedContent.includes(entity)) {
        matches++;
      }
    }

    return matches / requestedEntities.length;
  }

  private normalize(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
