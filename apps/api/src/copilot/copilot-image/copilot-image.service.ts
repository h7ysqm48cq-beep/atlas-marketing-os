import { Injectable } from '@nestjs/common';
import { BrandsService } from '../../brands/brands.service';
import { AssetImageBackgroundJobService } from '../../asset-image/asset-image-background-job.service';
import { ImagePromptEngineService } from '../../image-prompt-engine/image-prompt-engine.service';

@Injectable()
export class CopilotImageService {
  constructor(
    private readonly brands: BrandsService,
    private readonly backgroundJobs: AssetImageBackgroundJobService,
    private readonly imagePrompt: ImagePromptEngineService,
  ) {}

  async generate(input: {
    content: string;
    platform?: string;
    conversationId?: string;
    messageIndex?: number;
    pageId?: string;
    channelId?: string;
  }) {
    const brand = await this.brands.getActiveBrand();

    const prompt = this.imagePrompt.build({
      subject: input.content,
      purpose: 'social media marketing visual',
      platform: input.platform || 'Facebook post',
      language: 'Simplified Chinese',
      additionalInstructions: [
        'Create a premium branded visual.',
        'Keep composition clean.',
        'Use MGM brand style.',
      ],
    });

    return this.backgroundJobs.enqueue({
      name: 'copilot-generated-image',
      prompt: prompt.prompt,
      platform: input.platform || 'Facebook',
      conversationId: input.conversationId,
      messageIndex: input.messageIndex,
      pageId: input.pageId,
      channelId: input.channelId,
    });
  }
}
