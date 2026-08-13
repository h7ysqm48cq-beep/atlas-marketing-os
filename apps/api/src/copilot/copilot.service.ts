import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import OpenAI from 'openai';
import { calculateAiCost } from '../ai-cost/ai-cost';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { MemoryFactsService } from '../memory/memory-facts.service';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ConversationRecallService } from './conversation-recall.service';
import { ConversationEmbeddingService } from './conversation-embedding.service';
import { ConversationRecallFusionService } from './conversation-recall-fusion.service';
import { ConversationRecallContextBuilder } from './conversation-recall-context.builder';
import { PromptContextBuilder } from './prompt-context.builder';
import { PromptContextPipelineService } from './prompt/prompt-context-pipeline.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';
import { GenerationHistoryRecallService } from './generation-history-recall.service';

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  private readonly client: OpenAI | null;

  constructor(
    private readonly config: ConfigService,
    private readonly aiRuntime: AiRuntimeSettingsService,
    private readonly brands: BrandsService,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationMemoryService,
    private readonly conversationRecall: ConversationRecallService,
    private readonly conversationEmbedding: ConversationEmbeddingService,
    private readonly conversationRecallFusion: ConversationRecallFusionService,
    private readonly conversationRecallBuilder: ConversationRecallContextBuilder,
    private readonly memoryFacts: MemoryFactsService,
    private readonly knowledgeRetrieval: KnowledgeRetrievalService,
    private readonly promptContextBuilder: PromptContextBuilder,
    private readonly promptContextPipeline: PromptContextPipelineService,

    private readonly generationHistoryRecall: GenerationHistoryRecallService,
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

    const attachmentDocumentIds = attachments
      .filter(
        (attachment) => attachment.kind === 'document' && attachment.documentId,
      )
      .map((attachment) => attachment.documentId as string);

    const [
      conversationMessages,
      confirmedMemoryContext,
      attachmentKnowledgeMatches,
      conversationRecallResults,
      semanticConversationContext,
    ] = await Promise.all([
      this.conversations.recentMessages(conversation.id, 10),
      this.memoryFacts.confirmedPromptContext(),

      this.knowledgeRetrieval.searchAttachments({
        query: latestUserMessage.content,
        documentIds: attachmentDocumentIds,
        limitPerDocument: 4,
      }),

      this.conversationRecall.search({
        query: latestUserMessage.content,
        excludeConversationId: conversation.id,
      }),

      this.conversationEmbedding.search(latestUserMessage.content, {
        excludeConversationId: conversation.id,
        limit: 5,
      }),
    ]);

    /*
     * Fuse keyword and semantic conversation recall into
     * one deduplicated, ranked and budget-controlled block.
     */
    const previousConversationMemory = this.conversationRecallFusion.fuse(
      conversationRecallResults,
      semanticConversationContext,
      {
        query: latestUserMessage.content,
        limit: 7,
        maxCharsPerConversation: 1500,
        maxTotalChars: 7500,
      },
    );

    const attachmentDocumentContext =
      this.knowledgeRetrieval.buildPromptContext(attachmentKnowledgeMatches);

    /*
     * STUDIO_HISTORY_UNIFIED_RECALL
     *
     * Conversation recall answers:
     * "What did I ask before?"
     *
     * Generation history recall answers:
     * "What did I create in Studio before?"
     */
    const studioHistoryRecallItems = await this.generationHistoryRecall.search({
      query: latestUserMessage.content,
      brandId: brand.id,
      limit: 5,
    });

    const studioHistoryRecallContext =
      this.generationHistoryRecall.buildContext(studioHistoryRecallItems, {
        maxCharsPerItem: 1200,
        maxTotalChars: 4500,
      });

    /*
     * Current Studio context.
     *
     * Conversation memory tells Elena what the user
     * discussed before.
     *
     * Workspace context tells Elena what the user is
     * actively creating in AI Studio now.
     */
    const workspaceContext =
      dto.workspaceContext && typeof dto.workspaceContext === 'object'
        ? [
            'CURRENT ATLAS AI STUDIO WORKSPACE:',
            JSON.stringify(dto.workspaceContext, null, 2),
            '',
            "Treat this as the user's current working state.",
            'When the user refers to "this", "the current draft", "the image prompt", "what we are doing", or similar references, use this workspace context when relevant.',
            'Do not claim that a field exists when it is absent from the workspace context.',
          ].join('\n')
        : '';

    const baseContext = [
      'You are Elena, the AI marketing strategist inside Atlas Marketing OS.',
      `Current server UTC time: ${new Date().toISOString()}`,
      'Default operational timezone: Asia/Kuala_Lumpur.',

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
      previousConversationMemory,

      // Historical work created in AI Studio.
      studioHistoryRecallContext,

      // Current active AI Studio state.
      workspaceContext,

      attachmentDocumentContext,
      attachmentKnowledgeMatches.length
        ? 'Use the supplied KNOWLEDGE CONTEXT as the primary evidence for attached-document questions.'
        : attachmentDocumentIds.length
          ? 'No relevant document chunks were retrieved. Say clearly when the attached document does not provide enough evidence.'
          : '',
      attachmentKnowledgeMatches.length
        ? 'When answering from a document, cite the relevant [Source N] and Chunk number.'
        : '',
      'Never invent clauses, figures, rules or document content that are absent from the retrieved chunks.',
      'When images are attached, inspect the actual visual content instead of only describing the URL or filename.',
      'For marketing visuals, assess composition, hierarchy, readability, branding, platform suitability and likely audience response.',
      'Preserve Malaysian Chinese context when relevant.',
      'Avoid unsupported claims, fake urgency and unverified current facts.',
      'When rewriting, provide the improved version before the explanation.',

      /*
       * Atlas Workspace Action Protocol
       *
       * Elena may update the current AI Studio workspace when
       * the user explicitly asks to change an existing Studio draft.
       */
      'ATLAS ACTIVE VIEW RULES:',
      'CURRENT ATLAS AI STUDIO WORKSPACE may contain activeView.',
      'activeView=create means the user is currently working with Studio inputs such as topic, style, language, campaign and assets.',
      'activeView=results means the user is currently viewing the generated Facebook, Telegram, Reels, Image Prompt or generated visual.',
      'activeView=elena means the user is currently focused on this conversation, but the current Studio drafts still remain available as context.',
      'When activeView=results and the user says "this", "this post", "this draft", "the current one", "刚才那篇", "这篇", "这个文案", or similar references, prefer the current Studio result unless the conversation clearly indicates another item.',
      'When activeView=create and the user asks to change the topic, style, language or direction, treat it as a current Studio input change.',
      'Do not use activeView to override an explicit historical reference such as "the previous Grab article" or an exact named older item.',
      '',

      'ATLAS UNIFIED RECALL RULES:',
      'You may receive both PREVIOUS CONVERSATION context and PREVIOUS AI STUDIO WORK.',
      'Use PREVIOUS CONVERSATION to understand what the user previously asked, discussed, preferred, or decided.',
      'Use PREVIOUS AI STUDIO WORK to understand what the user previously generated or created in AI Studio.',
      'Use CURRENT ATLAS AI STUDIO WORKSPACE for what the user is actively working on now.',
      'When the user says "previous", "last time", "before", "continue that", "the one we made", or similar references, compare conversation recall, Studio history, and the current workspace before deciding what they mean.',
      'Prefer the current workspace when the user clearly refers to the content currently open.',
      'Prefer historical Studio work when the user asks what was previously created or asks to continue an older generated item.',
      'Prefer conversation recall when the user asks what they previously asked, discussed, requested, or decided.',
      'If several historical items could match, do not pretend certainty. Briefly identify the most likely matches.',
      'Never claim to remember an item that is not present in the supplied recall context.',
      '',
      'ATLAS WORKSPACE ACTION RULES:',

      'RESTORE HISTORY RULES:',
      'When the user asks to open, restore, continue, return to, or resume a previous AI Studio item, use PREVIOUS AI STUDIO WORK to identify the matching GenerationHistory.',
      'A restore action must use the exact History ID present in PREVIOUS AI STUDIO WORK.',
      'Never invent, guess, shorten, or modify a History ID.',
      'If exactly one historical Studio item clearly matches, you may restore it directly.',
      'If multiple historical Studio items plausibly match, ask the user which one instead of restoring the wrong item.',
      'Restore action format:',
      '<ATLAS_WORKSPACE_ACTION>',
      '{"type":"restore","historyId":"EXACT_GENERATION_HISTORY_ID"}',
      '</ATLAS_WORKSPACE_ACTION>',
      '',
      'You can directly operate the current Atlas AI Workspace when the user clearly requests an action.',
      'Supported executable actions are: replace, set, generate, restore, schedule, and batch.',
      '',
      'REPLACE: modify an existing Studio draft.',
      'Targets: facebook, telegram, reels, imagePrompt.',
      '',
      'SET: change Studio settings.',
      'Targets: topic, style, language.',
      '',
      'GENERATE: trigger Studio generation.',
      'Targets: content, image.',
      '',
      'SCHEDULE: add the current Facebook and/or Telegram draft into the existing Atlas Auto Queue.',
      'Schedule platforms must use FACEBOOK and/or TELEGRAM.',
      'Schedule date must use YYYY-MM-DD.',
      'Schedule time must use HH:MM in 24-hour format.',
      'Default timezone is Asia/Kuala_Lumpur.',
      '',
      'BATCH: perform several supported actions in logical order.',
      '',
      'Use exactly one <ATLAS_WORKSPACE_ACTION> block at the END of the response.',
      '',
      'Examples:',
      '<ATLAS_WORKSPACE_ACTION>',
      '{"type":"replace","target":"facebook","content":"FULL FINAL FACEBOOK COPY"}',
      '</ATLAS_WORKSPACE_ACTION>',
      '',
      '<ATLAS_WORKSPACE_ACTION>',
      '{"type":"generate","target":"content"}',
      '</ATLAS_WORKSPACE_ACTION>',
      '',
      '<ATLAS_WORKSPACE_ACTION>',
      '{"type":"schedule","platforms":["FACEBOOK"],"date":"2026-08-14","time":"20:00","timezone":"Asia/Kuala_Lumpur"}',
      '</ATLAS_WORKSPACE_ACTION>',
      '',
      '<ATLAS_WORKSPACE_ACTION>',
      '{"type":"batch","actions":[{"type":"set","target":"topic","value":"Grab Consumer Marketing"},{"type":"set","target":"style","value":"Educational"},{"type":"generate","target":"content"}]}',
      '</ATLAS_WORKSPACE_ACTION>',
      '',
      'Important execution rules:',
      '- Only emit actions when the user clearly asks you to perform the change.',
      '- Never emit an executable action merely for advice, brainstorming, explanation, or research.',
      '- Do not schedule empty platform drafts.',
      '- A schedule request creates an Auto Queue/ScheduledPost entry; it does not publish immediately.',
      '- PUBLISH, SEND NOW, DELETE, ARCHIVE and destructive actions are NOT available.',
      '- If the user asks to publish or send immediately, explain that Publish is currently locked and do not emit a publish action.',
      '- Do not invent a publish action.',
      '- Do not mention the hidden machine-readable action block to the user.',
      '',

      'PUBLISH IS LOCKED:',
      'You may schedule content into Atlas Auto Queue, but you must never publish or send content immediately.',
      'Do not emit publish, send-now, direct-post, or immediate-publish actions.',
      'If the user asks to publish now, explain that Publish is currently locked while Schedule remains available.',
      '',
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
      const requestStartedAt = Date.now();

      const model = await this.aiRuntime.getTextModel();

      const response = await this.client.responses.create({
        model,
        input: this.promptContextBuilder.build({
          context,
          conversationMessages,
          latestUserMessage: latestUserMessage.content,
          attachments,
        }),
      });

      const usage = response.usage;

      const promptTokens = usage?.input_tokens ?? 0;

      const cachedInputTokens = usage?.input_tokens_details?.cached_tokens ?? 0;

      const completionTokens = usage?.output_tokens ?? 0;

      const reasoningTokens =
        usage?.output_tokens_details?.reasoning_tokens ?? 0;

      const totalTokens =
        usage?.total_tokens ?? promptTokens + completionTokens;

      const durationMs = Date.now() - requestStartedAt;

      const cost = calculateAiCost({
        model,
        promptTokens,
        cachedInputTokens,
        completionTokens,
        usdToMyrRate: Number(
          this.config.get<string>('USD_TO_MYR_RATE') ?? '4.30',
        ),
      });

      if (!cost.pricingMatched) {
        this.logger.warn(`Missing AI pricing for model: ${model}`);
      }

      this.logger.log(
        JSON.stringify({
          event: 'copilot_openai_usage',
          responseId: response.id,
          conversationId: conversation.id,
          brandId: brand.id,
          campaignId: campaign?.id ?? null,
          mode,
          model,
          inputTokens: promptTokens,
          cachedInputTokens,
          outputTokens: completionTokens,
          reasoningTokens,
          totalTokens,
          estimatedCostUsd: cost.estimatedCostUsd,
          estimatedCostMyr: cost.estimatedCostMyr,
          durationMs,
          conversationMessageCount: conversationMessages.length,
          attachmentCount: attachments.length,
          attachmentDocumentCount: attachmentDocumentIds.length,
          knowledgeChunkCount: attachmentKnowledgeMatches.length,
        }),
      );

      try {
        await this.prisma.aiUsage.create({
          data: {
            historyId: null,
            conversationId: conversation.id,
            feature:
              mode === 'marketing-plan'
                ? 'COPILOT_MARKETING_PLAN'
                : 'COPILOT_CHAT',
            model,
            promptTokens,
            cachedInputTokens,
            completionTokens,
            reasoningTokens,
            totalTokens,
            estimatedCostUsd: cost.estimatedCostUsd,
            estimatedCostMyr: cost.estimatedCostMyr,
            durationMs,
          },
        });
      } catch (usageError) {
        this.logger.warn(
          JSON.stringify({
            event: 'copilot_ai_usage_persist_failed',
            responseId: response.id,
            conversationId: conversation.id,
            message:
              usageError instanceof Error
                ? usageError.message
                : 'Unknown persistence error',
          }),
        );
      }

      await this.conversations.appendAssistantMessage(
        conversation.id,
        response.output_text,
        {
          model,
          mode,
          knowledgeSources: attachmentKnowledgeMatches.map((match, index) => ({
            source: index + 1,
            documentId: match.documentId,
            title: match.title,
            file: match.sourceFileName,
            sourceUrl: match.sourceUrl,
            chunkIndex: match.chunkIndex,
            similarity: match.similarity,
            similarityPercent: match.similarityPercent,
            hybridScore: match.hybridScore,
          })),
        },
      );

      /*
       * Refresh semantic memory only after the completed
       * assistant response has been persisted.
       *
       * Embedding failure must never fail the Copilot reply.
       */
      try {
        await this.conversationEmbedding.embedConversation(conversation.id);
      } catch (embeddingError) {
        this.logger.warn(
          JSON.stringify({
            event: 'copilot_conversation_embedding_failed',
            conversationId: conversation.id,
            message:
              embeddingError instanceof Error
                ? embeddingError.message
                : 'Unknown embedding error',
          }),
        );
      }

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
}
