import { Injectable } from '@nestjs/common';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';

export type KnowledgeRetrievalMatch = {
  documentId: string;
  title: string;
  category: string;
  sourceFileName: string | null;
  sourceUrl: string | null;
  chunkIndex: number;
  chunkText: string;
  similarity: number;
  similarityPercent: number;
  hybridScore: number;
};

@Injectable()
export class KnowledgeRetrievalService {
  constructor(private readonly embeddings: KnowledgeEmbeddingService) {}

  async searchBrandKnowledge(input: {
    query: string;
    limit?: number;
    threshold?: number;
  }): Promise<KnowledgeRetrievalMatch[]> {
    const results = await this.embeddings.semanticSearch({
      query: input.query,
      limit: Math.min(Math.max(input.limit || 8, 1), 25),
      threshold: typeof input.threshold === 'number' ? input.threshold : 0.2,
    });

    return results.map((item) => this.toMatch(item));
  }

  async searchDocumentKnowledge(input: {
    documentId: string;
    query: string;
    limit?: number;
    threshold?: number;
  }): Promise<KnowledgeRetrievalMatch[]> {
    const results = await this.searchBrandKnowledge({
      query: input.query,
      limit: Math.min(Math.max((input.limit || 8) * 5, 20), 100),
      threshold: typeof input.threshold === 'number' ? input.threshold : 0.1,
    });

    return results
      .filter((item) => item.documentId === input.documentId)
      .slice(0, input.limit || 8);
  }

  async searchAttachments(input: {
    query: string;
    documentIds: string[];
    limitPerDocument?: number;
  }): Promise<KnowledgeRetrievalMatch[]> {
    const documentIds = Array.from(
      new Set(input.documentIds.filter(Boolean)),
    ).slice(0, 4);

    if (!documentIds.length) {
      return [];
    }

    const limitPerDocument = Math.min(
      Math.max(input.limitPerDocument || 6, 1),
      10,
    );

    const groups = await Promise.all(
      documentIds.map((documentId) =>
        this.searchDocumentKnowledge({
          documentId,
          query: input.query,
          limit: limitPerDocument,
        }),
      ),
    );

    return groups
      .flat()
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, 8);
  }

  buildPromptContext(matches: KnowledgeRetrievalMatch[]): string {
    if (!matches.length) {
      return '';
    }

    return [
      '=========================',
      'KNOWLEDGE CONTEXT',
      '=========================',
      '',
      ...matches.flatMap((match, index) => [
        `[Source ${index + 1} | ${match.title} | Chunk ${match.chunkIndex}]`,
        match.chunkText,
        '',
      ]),
    ]
      .filter(Boolean)
      .join('\n');
  }

  private toMatch(item: any): KnowledgeRetrievalMatch {
    return {
      documentId: item.document.id,
      title: item.document.title,
      category: item.document.category,
      sourceFileName: item.document.sourceFileName || null,
      sourceUrl: item.document.sourceUrl || null,
      chunkIndex: item.embedding?.chunkIndex ?? item.chunkIndex ?? 0,
      chunkText:
        item.embedding?.chunkText ?? item.chunkText ?? item.document.content,
      similarity: item.similarity ?? 0,
      similarityPercent:
        item.similarityPercent ?? Math.round((item.similarity || 0) * 100),
      hybridScore: item.hybridScore ?? item.similarityPercent ?? 0,
    };
  }
}
