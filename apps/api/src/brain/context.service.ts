import { Injectable } from '@nestjs/common';
import {
  AtlasBrainContext,
  AtlasBrainInput,
} from './brain.types';

@Injectable()
export class BrainContextService {
  build(input: AtlasBrainInput): AtlasBrainContext {
    const message = this.clean(input.message);

    return {
      message,
      normalizedMessage: message.toLowerCase(),
      userId: this.optional(input.userId),
      brandId: this.optional(input.brandId),
      conversationId: this.optional(input.conversationId),
      locale: this.optional(input.locale) ?? 'en-MY',
      metadata: this.cleanMetadata(input.metadata),
      createdAt: new Date().toISOString(),
    };
  }

  private clean(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private optional(value?: string): string | undefined {
    const cleaned = value?.trim();
    return cleaned || undefined;
  }

  private cleanMetadata(
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!metadata) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([key, value]) => key.trim() && value !== undefined,
      ),
    );
  }
}
