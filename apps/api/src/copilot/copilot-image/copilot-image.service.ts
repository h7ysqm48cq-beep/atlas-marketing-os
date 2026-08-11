
import { Injectable } from '@nestjs/common';
import { BrandsService } from '../../brands/brands.service';
import { AssetImageService } from '../../asset-image/asset-image.service';
import { ImagePromptEngineService } from '../../image-prompt-engine/image-prompt-engine.service';


@Injectable()
export class CopilotImageService {

  constructor(
    private readonly brands: BrandsService,
    private readonly assetImage: AssetImageService,
    private readonly imagePrompt:
      ImagePromptEngineService,
  ) {}


  async generate(
    input: {
      content:string;
      platform?:string;
    },
  ) {

    const brand =
      await this.brands.getActiveBrand();


    const prompt =
      this.imagePrompt.build({
        subject: input.content,
        purpose:
          'social media marketing visual',
        platform:
          input.platform || 'Facebook post',
        language:
          'Simplified Chinese',
        additionalInstructions:[
          'Create a premium branded visual.',
          'Keep composition clean.',
          'Use MGM brand style.',
        ],
      });


    return this.assetImage.generateAndSave({
      name:
        'copilot-generated-image',
      prompt:
        prompt.prompt,
      platform:
        input.platform || 'Facebook',
    });
  }

}
