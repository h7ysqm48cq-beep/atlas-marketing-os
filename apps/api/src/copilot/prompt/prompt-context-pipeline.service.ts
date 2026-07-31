import { Injectable } from '@nestjs/common';
import {
  BuildUnifiedPromptContextInput,
  UnifiedPromptContext,
} from './prompt-context.types';

@Injectable()
export class PromptContextPipelineService {
  build(
    input: BuildUnifiedPromptContextInput,
  ): UnifiedPromptContext {
    return {
      systemInstructions: this.cleanStrings(
        input.systemInstructions ?? [],
      ),

      brandContext: this.cleanText(input.brandContext),
      campaignContext: this.cleanText(input.campaignContext),
      memoryContext: this.cleanText(input.memoryContext),
      knowledgeContext: this.cleanText(input.knowledgeContext),
      attachmentContext: this.cleanText(input.attachmentContext),

      conversationMessages:
        input.conversationMessages ?? [],

      latestUserMessage:
        input.latestUserMessage.trim(),

      attachments: input.attachments ?? [],
      knowledgeSources:
        input.knowledgeSources ?? [],
    };
  }

  buildSystemContext(
    context: UnifiedPromptContext,
  ): string {
    const sections: string[] = [];

    this.push(
      sections,
      'SYSTEM INSTRUCTIONS',
      context.systemInstructions.join('\n'),
    );

    this.push(
      sections,
      'BRAND CONTEXT',
      context.brandContext,
    );

    this.push(
      sections,
      'CAMPAIGN CONTEXT',
      context.campaignContext,
    );

    this.push(
      sections,
      'MEMORY CONTEXT',
      context.memoryContext,
    );

    this.push(
      sections,
      'KNOWLEDGE CONTEXT',
      context.knowledgeContext,
    );

    this.push(
      sections,
      'ATTACHMENT CONTEXT',
      context.attachmentContext,
    );

    return sections.join('\n\n');
  }

  private push(
    sections: string[],
    title: string,
    value?: string,
  ): void {
    if (!value) {
      return;
    }

    sections.push(`${title}\n${value}`);
  }

  private cleanStrings(
    values: string[],
  ): string[] {
    return values
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private cleanText(
    value?: string,
  ): string | undefined {
    const cleaned = value?.trim();

    return cleaned || undefined;
  }
}
