import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetImageBackgroundJobService } from '../../asset-image/asset-image-background-job.service';
import { AssetImageService } from '../../asset-image/asset-image.service';
import { GenerateAssetImageDto } from '../../asset-image/dto/generate-asset-image.dto';
import { ImagePromptEngineService } from '../../image-prompt-engine/image-prompt-engine.service';
import { parseCopilotImageDirectives } from './copilot-image-directives';

@Injectable()
export class CopilotImageService {
  constructor(
    private readonly backgroundJobs: AssetImageBackgroundJobService,
    private readonly assetImages: AssetImageService,
    private readonly config: ConfigService,
    private readonly imagePrompt: ImagePromptEngineService,
  ) {}

  async generate(input: {
    content: string;
    instructions?: string;
    platform?: string;
    conversationId?: string;
    messageIndex?: number;
    pageId?: string;
    channelId?: string;
  }) {
    const directives = parseCopilotImageDirectives(
      input.instructions?.trim() || input.content,
    );
    const requestedAspectRatio =
      directives.aspectRatio ??
      (directives.outputWidth && directives.outputHeight
        ? `${directives.outputWidth}:${directives.outputHeight}`
        : undefined);

    const prompt = this.imagePrompt.build({
      subject: input.content,
      purpose: 'social media marketing visual',
      platform: input.platform || 'Facebook post',
      aspectRatio: requestedAspectRatio,
      language: 'Simplified Chinese',
      brandPlacement:
        'Do not render any logo, brand name, website, signature, or watermark. Leave clean space for Atlas to add official branding after generation.',
      additionalInstructions: [
        'Create a premium visual aligned with the brand style without rendering brand text or logos.',
        'Keep composition clean.',
      ],
    });
    const outputDirectives =
      directives.outputWidth && directives.outputHeight
        ? directives
        : {
            ...directives,
            aspectRatio: directives.aspectRatio ?? prompt.aspectRatio,
          };

    const payload: GenerateAssetImageDto = {
      name: 'Atlas Copilot image',
      prompt: prompt.prompt,
      platform: input.platform || 'Facebook',
      conversationId: input.conversationId,
      messageIndex: input.messageIndex,
      pageId: input.pageId,
      channelId: input.channelId,
      textOverlayMode: 'AUTO',
      ...outputDirectives,
    };

    if (this.shouldGenerateDirectly()) {
      const startedAt = new Date();
      const result = await this.assetImages.generateAndSave(payload);
      const completedAt = new Date();

      /*
       * Development instances may share a database with an older deployed
       * worker. Returning the completed result from this process prevents that
       * worker from claiming the job and saving an image without the current
       * source-image and branding metadata. Keep the durable queue in
       * production, where all workers are deployed together.
       */
      return {
        id: `direct-${result.asset.id}`,
        status: 'SUCCEEDED' as const,
        payload,
        result,
        error: null,
        attempts: 1,
        startedAt,
        completedAt,
        createdAt: startedAt,
        updatedAt: completedAt,
      };
    }

    return this.backgroundJobs.enqueue(payload);
  }

  private shouldGenerateDirectly() {
    const executionMode = this.config
      .get<string>('COPILOT_IMAGE_EXECUTION_MODE')
      ?.trim()
      .toLowerCase();

    if (executionMode === 'direct') {
      return true;
    }

    if (executionMode === 'background') {
      return false;
    }

    return this.config.get<string>('NODE_ENV') !== 'production';
  }
}
