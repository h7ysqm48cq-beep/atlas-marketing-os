import {
  BadGatewayException,
  Injectable,
} from '@nestjs/common';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { ContextService } from '../context/context.service';
import { ContentValidatorService } from '../content-validator/content-validator.service';
import { HistoryService } from '../history/history.service';
import { ImagePromptEngineService } from '../image-prompt-engine/image-prompt-engine.service';
import { PromptBuilderService } from '../prompt-builder/prompt-builder.service';
import type {
  StructuredMarketingOutput,
} from '../prompt-builder/prompt-builder.types';
import type {
  ContentEngineResult,
  GenerateContentInput,
} from './content-engine.types';

@Injectable()
export class ContentEngineService {
  constructor(
    private readonly contextService:
      ContextService,
    private readonly promptBuilderService:
      PromptBuilderService,
    private readonly aiProviderService:
      AiProviderService,
    private readonly historyService:
      HistoryService,
    private readonly contentValidatorService:
      ContentValidatorService,
    private readonly imagePromptEngineService:
      ImagePromptEngineService,
  ) {}

  status() {
    return {
      engine: 'content',
      status: 'ready',
    };
  }

  async generate(
    input: GenerateContentInput,
  ): Promise<ContentEngineResult> {
    const context =
      await this.contextService.build({
        prompt: input.prompt,
        campaignId: input.campaignId,
        platforms: input.platforms,
        language: input.language,
        style: input.style,
        knowledgeLimit: 5,
      });

    const builtPrompt =
      this.promptBuilderService.build(
        context,
      );

    const providerResult =
      await this.aiProviderService.generate(
        {
          system: builtPrompt.system,
          user: builtPrompt.user,
        },
        {
          model: input.model,
          maxOutputTokens: 1800,
          responseFormat:
            builtPrompt.outputFormat,
        },
      );

    let output:
      StructuredMarketingOutput;

    try {
      output = JSON.parse(
        providerResult.text,
      ) as StructuredMarketingOutput;
    } catch {
      throw new BadGatewayException(
        'AI provider returned invalid structured JSON.',
      );
    }

    const validation =
      this.contentValidatorService.validate(
        output,
        context,
      );

    const platformImagePrompts =
      Object.fromEntries(
        context.request.platforms.map(
          (platform) => {
            const result =
              this.imagePromptEngineService.build({
                subject:
                  output.imagePrompt,
                purpose:
                  platform.toLowerCase() === 'reels'
                    ? 'Reels visual'
                    : `${platform} post`,
                platform,
                language:
                  context.request.language,
                onImageText: [
                  output.hook,
                ],
                brandPlacement:
                  'Place the brand subtly at the bottom center, small but readable.',
                additionalInstructions: [
                  context.brand.visualStyle,
                  'Avoid an overly promotional appearance.',
                  'Keep the main subject visually dominant.',
                ],
              });

            return [
              platform.toLowerCase(),
              {
                prompt: result.prompt,
                negativePrompt:
                  result.negativePrompt,
                aspectRatio:
                  result.aspectRatio,
              },
            ];
          },
        ),
      );

    output.imagePrompts =
      platformImagePrompts;

    const primaryImagePrompt =
      platformImagePrompts.reels ??
      platformImagePrompts.facebook ??
      Object.values(
        platformImagePrompts,
      )[0];

    if (primaryImagePrompt) {
      output.imagePrompt =
        primaryImagePrompt.prompt;
    }

    const history =
      validation.valid
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
              [
                output.facebook.caption,
                output.facebook.discussionQuestion,
              ]
                .filter(Boolean)
                .join('\n\n'),
            telegram:
              [
                output.telegram.message,
                output.telegram.callToAction,
              ]
                .filter(Boolean)
                .join('\n\n'),
            reels:
              JSON.stringify(output.reels),
            imagePrompt:
              output.imagePrompt,
            analysis: {
              title: output.title,
              hook: output.hook,
              hashtags: output.hashtags,
              provider:
                providerResult.provider,
              model:
                providerResult.model,
              usage:
                providerResult.usage,
              durationMs:
                providerResult.durationMs,
              contextMetadata: {
                ...context.metadata,
                createdAt:
                  context.metadata.createdAt
                    .toISOString(),
              },
              promptMetadata: {
                ...builtPrompt.metadata,
                createdAt:
                  builtPrompt.metadata.createdAt
                    .toISOString(),
              },
              outputFormat:
                builtPrompt.outputFormat,
              validation: {
                valid:
                  validation.valid,
                score:
                  validation.score,
                issues:
                  validation.issues,
              },
              imagePromptEngine: {
                platforms:
                  platformImagePrompts,
              },
            },
          })
        : null;

    return {
      output,
      validation,
      historyId: history?.id ?? null,
      provider:
        providerResult.provider,
      model:
        providerResult.model,
      usage:
        providerResult.usage,
      durationMs:
        providerResult.durationMs,
    };
  }
}
