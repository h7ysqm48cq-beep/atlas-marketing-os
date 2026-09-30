import { Injectable } from '@nestjs/common';

import {
  BrandBrainRules,
} from './brand-brain-rules.types';


@Injectable()
export class BrandBrainRulesService {


  resolve(
    rules?: BrandBrainRules | null,
  ): BrandBrainRules {

    return {

      imagePolicy: {
        logoEnabled:
          rules?.imagePolicy?.logoEnabled ??
          true,

        footerEnabled:
          rules?.imagePolicy?.footerEnabled ??
          true,

        allowAIText:
          rules?.imagePolicy?.allowAIText ??
          false,
      },


      visualPolicy: {
        visualStyle:
          rules?.visualPolicy?.visualStyle ??
          'cinematic realistic',

        colorDirection:
          rules?.visualPolicy?.colorDirection ??
          'brand aligned',

        photographyStyle:
          rules?.visualPolicy?.photographyStyle ??
          'premium advertising',
      },


      promptPolicy: {
        systemPrompt:
          rules?.promptPolicy?.systemPrompt ??
          '',

        negativePrompt:
          rules?.promptPolicy?.negativePrompt ??
          '',
      },


      channelPolicy: {
        platform:
          rules?.channelPolicy?.platform ??
          'multi-platform',

        aspectRatio:
          rules?.channelPolicy?.aspectRatio ??
          '4:5',
      },

    };

  }

}
