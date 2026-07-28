import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { MemoryFactsService } from '../memory/memory-facts.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { PromptContextBuilder } from './prompt-context.builder';
import { ChatCopilotDto } from './dto/chat-copilot.dto';

@Injectable()
export class CopilotService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly config: ConfigService,
    private readonly brands: BrandsService,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationMemoryService,
    private readonly memoryFacts: MemoryFactsService,
    private readonly promptContextBuilder: PromptContextBuilder,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async chat(dto: ChatCopilotDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const brand = await this.brands.getActiveBrand();

    const campaign = dto.campaignId
      ? await this.prisma.campaign.findFirst({
          where: {
            id: dto.campaignId,
            brandId: brand.id,
          },
          select: {
            id: true,
            name: true,
            description: true,
            objective: true,
          },
        })
      : null;

    if (dto.campaignId && !campaign) {
      throw new NotFoundException('Campaign not found.');
    }

    const mode = dto.mode || 'chat';

    const latestUserMessage = [...dto.messages]
      .reverse()
      .find((message) => message.role === 'user' && message.content.trim());

    if (!latestUserMessage) {
      throw new InternalServerErrorException('A user message is required.');
    }

    const conversation = await this.conversations.ensureConversation({
      conversationId: dto.conversationId,
      campaignId: dto.campaignId,
      mode,
      firstMessage: latestUserMessage.content,
    });

    const attachments = this.cleanAttachments(dto.attachments);

    await this.conversations.appendUserMessage(
      conversation.id,
      latestUserMessage.content,
      attachments.length
        ? {
            attachments,
          }
        : undefined,
    );

    const [
      conversationMessages,
      confirmedMemoryContext,
      attachmentDocumentContext,
    ] = await Promise.all([
      this.conversations.recentMessages(conversation.id, 20),
      this.memoryFacts.confirmedPromptContext(),
      this.getAttachmentDocumentContext(attachments, brand.id),
    ]);

    const baseContext = [
      'You are Elena, the AI marketing strategist inside Atlas Marketing OS.',
      'You are practical, commercially aware, creative and direct.',
      `Brand: ${brand.name}`,
      `Country: ${brand.country}`,
      `Audience: ${brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Visual style: ${brand.visualStyle}`,
      `Content goals: ${brand.contentGoals}`,
      `Keywords: ${brand.keywords.join(', ')}`,
      `Rules: ${brand.brandRules.join(' | ')}`,
      `Forbidden words: ${brand.forbiddenWords.join(', ')}`,
      campaign
        ? `Campaign: ${campaign.name}
Objective: ${campaign.objective || 'Not set'}
Description: ${campaign.description || 'Not set'}`
        : 'Campaign: none selected',
      confirmedMemoryContext,
      attachmentDocumentContext,
      'When images are attached, inspect the actual visual content instead of only describing the URL or filename.',
      'For marketing visuals, assess composition, hierarchy, readability, branding, platform suitability and likely audience response.',
      'Preserve Malaysian Chinese context when relevant.',
      'Avoid unsupported claims, fake urgency and unverified current facts.',
      'When rewriting, provide the improved version before the explanation.',
      'Keep outputs ready to copy and use.',
    ];

    const modeContext =
      mode === 'marketing-plan'
        ? [
            'The user has selected MARKETING PLAN mode.',
            'Always produce a complete marketing package using this exact structure:',
            '',
            '## 核心创意',
            'Explain the central idea in 2 to 4 concise sentences.',
            '',
            '## Facebook 文案',
            'Write a natural Facebook-ready caption.',
            '',
            '## Telegram 文案',
            'Write a shorter, more direct Telegram version.',
            '',
            '## Reels Hook',
            'Give 3 strong opening hooks suitable for short video.',
            '',
            '## CTA',
            'Give one clear but natural call to action.',
            '',
            '## Hashtags',
            'Give 5 to 10 relevant hashtags.',
            '',
            '## 图片 Prompt',
            'Write one detailed English image-generation prompt.',
            '',
            '## 风险检查',
            'Mention any brand, compliance, factual or platform risk. Write "无明显风险" when appropriate.',
            '',
            'Use clear headings and do not omit any section.',
          ]
        : [
            'The user has selected CHAT mode.',
            'Answer naturally as an ongoing marketing conversation.',
            'Do not force the full marketing-plan structure unless the user asks for a complete package.',
          ];

    const context = [...baseContext, ...modeContext].join('\n');

    try {
      const response = await this.client.responses.create({
        model: this.config.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini',
        input: this.promptContextBuilder.build({
          context,
          conversationMessages,
          latestUserMessage: latestUserMessage.content,
          attachments,
        }),
      });

      await this.conversations.appendAssistantMessage(
        conversation.id,
        response.output_text,
        {
          model: this.config.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini',
          mode,
        },
      );

      return {
        reply: response.output_text,
        mode,
        conversation: {
          id: conversation.id,
          title: conversation.title,
        },
        brand: {
          id: brand.id,
          name: brand.name,
        },
        campaign: campaign
          ? {
              id: campaign.id,
              name: campaign.name,
            }
          : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      throw new InternalServerErrorException(
        `Elena Copilot failed: ${message}`,
      );
    }
  }

  private cleanAttachments(attachments: ChatCopilotDto['attachments']) {
    if (!attachments?.length) {
      return [];
    }

    const allowedImageTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);

    return attachments
      .filter((attachment) => {
        if (!attachment.url.startsWith('https://')) {
          return false;
        }

        if (attachment.kind === 'image') {
          return allowedImageTypes.has(attachment.mimeType.toLowerCase());
        }

        return Boolean(attachment.documentId);
      })
      .slice(0, 4)
      .map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.mimeType,
        url: attachment.url,
        storageProvider: attachment.storageProvider,
        storagePath: attachment.storagePath,
        documentId: attachment.documentId,
      }));
  }

  private buildVisionInput(input: {
    context: string;
    conversationMessages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    latestUserMessage: string;
    attachments: Array<{
      id: string;
      kind: 'image' | 'document';
      name: string;
      mimeType: string;
      url: string;
      documentId?: string;
    }>;
  }) {
    const history = input.conversationMessages.slice(0, -1);

    const imageAttachments = input.attachments.filter(
      (attachment) => attachment.kind === 'image',
    );

    const latestContent: Array<
      | {
          type: 'input_text';
          text: string;
        }
      | {
          type: 'input_image';
          image_url: string;
          detail: 'auto';
        }
    > = [
      {
        type: 'input_text',
        text: input.latestUserMessage || 'Please review the attached image.',
      },
      ...imageAttachments.map((attachment) => ({
        type: 'input_image' as const,
        image_url: attachment.url,
        detail: 'auto' as const,
      })),
    ];

    return [
      {
        role: 'developer' as const,
        content: input.context,
      },
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: 'user' as const,
        content: latestContent,
      },
    ];
  }

  private async getAttachmentDocumentContext(
    attachments: Array<{
      kind: 'image' | 'document';
      name: string;
      documentId?: string;
    }>,
    brandId: string,
  ) {
    const documentAttachments = attachments
      .filter(
        (attachment) => attachment.kind === 'document' && attachment.documentId,
      )
      .slice(0, 2);

    if (!documentAttachments.length) {
      return '';
    }

    const documentIds = documentAttachments
      .map((attachment) => attachment.documentId)
      .filter((value): value is string => Boolean(value));

    const documents = await this.prisma.knowledgeDocument.findMany({
      where: {
        id: {
          in: documentIds,
        },
        brandId,
      },
      select: {
        id: true,
        title: true,
        category: true,
        content: true,
        sourceFileName: true,
      },
    });

    if (!documents.length) {
      return '';
    }

    return [
      'Attached document context:',
      ...documents.map((document) => {
        const cleanContent = document.content
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 12000);

        return [
          `Document: ${document.sourceFileName || document.title}`,
          `Category: ${document.category}`,
          cleanContent,
        ].join('\n');
      }),
    ].join('\n\n');
  }
}
