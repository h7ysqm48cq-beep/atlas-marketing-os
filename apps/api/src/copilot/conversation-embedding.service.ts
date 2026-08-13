import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import { PrismaService } from '../database/prisma.service';
import { BrandsService } from '../brands/brands.service';

@Injectable()
export class ConversationEmbeddingService {
  private readonly client: OpenAI | null;

  /*
   * Conservative default.
   *
   * We do not want weak semantic matches polluting the
   * Copilot prompt with unrelated historical conversations.
   */
  private readonly similarityThreshold = 0.45;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
    private readonly aiRuntime: AiRuntimeSettingsService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  /**
   * Rebuild the semantic representation for one conversation.
   *
   * The embedding represents recent conversation context,
   * rather than only the latest user message.
   */
  async embedConversation(conversationId: string) {
    if (!this.client) {
      return null;
    }

    const brand = await this.brands.getActiveBrand();

    const conversation = await this.prisma.copilotConversation.findFirst({
      where: {
        id: conversationId,
        brandId: brand.id,
        isArchived: false,
      },
      select: {
        id: true,
        title: true,
        mode: true,
        messages: {
          select: {
            role: true,
            content: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 20,
        },
      },
    });

    if (!conversation) {
      return null;
    }

    const messages = conversation.messages.reverse();

    if (!messages.length) {
      return null;
    }

    const content = [
      `Conversation: ${conversation.title}`,
      `Mode: ${conversation.mode}`,
      '',
      ...messages.map(
        (message) =>
          `${message.role === 'USER' ? 'User' : 'Assistant'}: ${message.content}`,
      ),
    ]
      .join('\n')
      .slice(0, 6000);

    const result = await this.client.embeddings.create({
      model: await this.aiRuntime.getEmbeddingModel(),
      input: content,
    });

    const vector = result.data[0]?.embedding;

    if (!vector?.length) {
      return null;
    }

    return this.prisma.copilotConversationEmbedding.upsert({
      where: {
        conversationId,
      },
      update: {
        content,
        vector,
        model: await this.aiRuntime.getEmbeddingModel(),
        dimensions: vector.length,
      },
      create: {
        brandId: brand.id,
        conversationId,
        content,
        vector,
        model: await this.aiRuntime.getEmbeddingModel(),
        dimensions: vector.length,
      },
    });
  }

  /**
   * Search semantic memory across previous conversations.
   *
   * The active conversation can be explicitly excluded to
   * prevent self-recall.
   */
  async search(
    query: string,
    options?: {
      excludeConversationId?: string;
      limit?: number;
      threshold?: number;
    },
  ) {
    if (!this.client) {
      return [];
    }

    const cleanQuery = query.replace(/\s+/g, ' ').trim();

    if (!cleanQuery) {
      return [];
    }

    const brand = await this.brands.getActiveBrand();

    const result = await this.client.embeddings.create({
      model: await this.aiRuntime.getEmbeddingModel(),
      input: cleanQuery.slice(0, 6000),
    });

    const vector = result.data[0]?.embedding;

    if (!vector?.length) {
      return [];
    }

    const rows = await this.prisma.copilotConversationEmbedding.findMany({
      where: {
        brandId: brand.id,
        conversationId: options?.excludeConversationId
          ? {
              not: options.excludeConversationId,
            }
          : undefined,
        conversation: {
          isArchived: false,
        },
      },
      select: {
        id: true,
        conversationId: true,
        content: true,
        model: true,
        dimensions: true,
        vector: true,
        updatedAt: true,
        conversation: {
          select: {
            title: true,
            mode: true,
            updatedAt: true,
          },
        },
      },
    });

    const threshold = options?.threshold ?? this.similarityThreshold;

    const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);

    return rows
      .map((row) => {
        const storedVector = Array.isArray(row.vector)
          ? (row.vector as number[])
          : [];

        if (
          storedVector.length === 0 ||
          storedVector.length !== vector.length
        ) {
          return null;
        }

        const score = this.cosine(vector, storedVector);

        return {
          conversationId: row.conversationId,
          title: row.conversation.title,
          mode: row.conversation.mode,
          content: row.content,
          score,
          updatedAt: row.conversation.updatedAt,
        };
      })
      .filter(
        (
          row,
        ): row is {
          conversationId: string;
          title: string;
          mode: string;
          content: string;
          score: number;
          updatedAt: Date;
        } => row !== null && row.score >= threshold,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private cosine(a: number[], b: number[]) {
    if (!a.length || a.length !== b.length) {
      return 0;
    }

    let dot = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);

    if (!denominator) {
      return 0;
    }

    return dot / denominator;
  }
}
