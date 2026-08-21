export type BrandBrainRules = {

  imagePolicy?: {

    logoEnabled?: boolean;

    footerEnabled?: boolean;

    allowAIText?: boolean;

  };


  visualPolicy?: {

    visualStyle?: string;

    colorDirection?: string;

    photographyStyle?: string;

  };


  promptPolicy?: {

    systemPrompt?: string;

    negativePrompt?: string;

  };


  channelPolicy?: {

    platform?: string;

    aspectRatio?: string;

  };

};
