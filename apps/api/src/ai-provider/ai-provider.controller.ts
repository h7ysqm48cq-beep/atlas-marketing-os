import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { ContextService } from '../context/context.service';
import { HistoryService } from '../history/history.service';
import { PromptBuilderService } from '../prompt-builder/prompt-builder.service';
import type { StructuredMarketingOutput } from '../prompt-builder/prompt-builder.types';
import { AiProviderService } from './ai-provider.service';

type TestAiProviderDto = {
  prompt: string;
  campaignId?: string;
  platforms?: string[];
  language?: string;
  style?: string;
  model?: string;
  provider?: 'openai' | 'google';
};

@Controller('ai-provider')
export class AiProviderController {
  constructor(
    private readonly contextService:
      ContextService,
    private readonly promptBuilderService:
      PromptBuilderService,
    private readonly aiProviderService:
      AiProviderService,
    private readonly historyService:
      HistoryService,
  ) {}

  @Post('test')
  async test(
    @Body() dto: TestAiProviderDto,
  ) {
    const context =
      await this.contextService.build({
        prompt: dto.prompt,
        campaignId: dto.campaignId,
        platforms: dto.platforms,
        language: dto.language,
        style: dto.style,
        knowledgeLimit: 3,
      });

    const builtPrompt =
      this.promptBuilderService.build(
        context,
      );

    const result =
      await this.aiProviderService.generate(
        {
          system: builtPrompt.system,
          user: builtPrompt.user,
        },
        {
          provider: dto.provider,
          model: dto.model,
          maxOutputTokens: 1600,
          responseFormat:
            builtPrompt.outputFormat,
        },
      );

    let structuredResult:
      StructuredMarketingOutput | null = null;

    if (
      builtPrompt.outputFormat === 'json'
    ) {
      try {
        structuredResult =
          JSON.parse(
            result.text,
          ) as StructuredMarketingOutput;
      } catch {
        structuredResult = null;
      }
    }

    const history =
      structuredResult
        ? await this.historyService.save({
            brandId: context.brand.id,
            campaignId:
              context.request.campaignId ??
              undefined,
            topic: context.request.prompt,
            platforms:
              context.request.platforms,
            style:
              context.request.style,
            language:
              context.request.language,
            facebook:
              structuredResult.facebook.caption,
            telegram:
              [
                structuredResult.telegram.message,
                structuredResult.telegram.callToAction,
              ]
                .filter(Boolean)
                .join('\n\n'),
            reels:
              JSON.stringify(
                structuredResult.reels,
              ),
            imagePrompt:
              structuredResult.imagePrompt,
            analysis: {
              title:
                structuredResult.title,
              hook:
                structuredResult.hook,
              discussionQuestion:
                structuredResult.facebook
                  .discussionQuestion,
              hashtags:
                structuredResult.hashtags,
              provider:
                result.provider,
              model:
                result.model,
              usage:
                result.usage,
              durationMs:
                result.durationMs,
              contextMetadata:
                context.metadata,
              promptMetadata:
                builtPrompt.metadata,
              outputFormat:
                builtPrompt.outputFormat,
            },
          })
        : null;

    return {
      contextMetadata:
        context.metadata,
      promptMetadata:
        builtPrompt.metadata,
      outputFormat:
        builtPrompt.outputFormat,
      history: history
        ? {
            id: history.id,
            status: history.status,
            createdAt: history.createdAt,
          }
        : null,
      result: {
        ...result,
        structured:
          structuredResult,
      },
    };
  }
}
