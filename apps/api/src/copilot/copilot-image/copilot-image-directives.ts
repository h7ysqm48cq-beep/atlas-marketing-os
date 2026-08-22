import { GenerateAssetImageDto } from '../../asset-image/dto/generate-asset-image.dto';

type ImageDirectives = Partial<
  Pick<
    GenerateAssetImageDto,
    | 'textOverlayMode'
    | 'textOverlayText'
    | 'brandFooterMode'
    | 'footerLogoMode'
    | 'footerText'
    | 'logoMode'
    | 'logoPlacement'
    | 'logoScale'
    | 'logoOpacity'
    | 'outputWidth'
    | 'outputHeight'
    | 'aspectRatio'
  >
>;

const quotedValue = (input: string, labels: string) =>
  input
    .match(
      new RegExp(
        `(?:${labels})\\s*(?:为|是|=|:|：)?\\s*[「“"]([^」”"]{1,100})[」”"]`,
        'i',
      ),
    )?.[1]
    ?.trim();

export function parseCopilotImageDirectives(input: string): ImageDirectives {
  const text = input.trim();
  const directives: ImageDirectives = {};

  const resolution = text.match(
    /(?:分辨率|尺寸|resolution|size)?\s*(\d{3,4})\s*[x×＊]\s*(\d{3,4})/i,
  );

  if (resolution) {
    const width = Number(resolution[1]);
    const height = Number(resolution[2]);

    if (width >= 256 && width <= 4096 && height >= 256 && height <= 4096) {
      directives.outputWidth = width;
      directives.outputHeight = height;
    }
  } else {
    const ratio = text.match(
      /(?:(?:比例|画幅|aspect\s*ratio)\s*(?:为|是|=|:|：)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})|(?:生成|做成|使用|输出)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*(?:图片|图像|画幅|比例|$))/i,
    );
    const ratioWidth = Number(ratio?.[1] ?? ratio?.[3]);
    const ratioHeight = Number(ratio?.[2] ?? ratio?.[4]);

    if (ratio && ratioWidth > 0 && ratioHeight > 0) {
      directives.aspectRatio = `${ratioWidth}:${ratioHeight}`;
    }
  }

  const overlayText = quotedValue(
    text,
    'text\\s*overlay|overlay\\s*text|文字叠加|叠加文字|图片文字|主标题',
  );

  if (overlayText) {
    directives.textOverlayMode = 'ALWAYS';
    directives.textOverlayText = overlayText.slice(0, 70);
  } else if (
    /(?:不要|关闭|关掉|移除|去掉|无|no|disable|off).{0,12}(?:text\s*overlay|文字叠加|叠加文字|图片文字)/i.test(
      text,
    ) ||
    /(?:text\s*overlay|文字叠加|叠加文字|图片文字).{0,8}(?:关闭|关掉|off)/i.test(
      text,
    )
  ) {
    directives.textOverlayMode = 'NEVER';
    directives.textOverlayText = '';
  }

  const footerText = quotedValue(text, 'footer\\s*text|页脚文字|footer|页脚');

  if (footerText) {
    directives.brandFooterMode = 'ALWAYS';
    directives.footerText = footerText.slice(0, 100);
  }

  const mentionsFooterLogo = /footer\s*logo|页脚\s*(?:logo|标志)/i.test(text);
  const explicitlyDisablesCornerLogo =
    /(?:不要|关闭|关掉|移除|去掉|无|no|disable|off).{0,12}(?:corner\s*logo|角标|角落\s*(?:logo|标志))/i.test(
      text,
    ) ||
    /(?:corner\s*logo|角标|角落\s*(?:logo|标志)).{0,8}(?:关闭|关掉|隐藏|off|hide)/i.test(
      text,
    );
  const explicitlyEnablesCornerLogo =
    /(?:开启|打开|显示|启用|加上|enable|show|on).{0,12}(?:corner\s*logo|角标|角落\s*(?:logo|标志))/i.test(
      text,
    ) ||
    /(?:corner\s*logo|角标|角落\s*(?:logo|标志)).{0,8}(?:开启|打开|显示|on|show)/i.test(
      text,
    );

  if (
    !mentionsFooterLogo &&
    /(?:不要|关闭|关掉|移除|去掉|无|no|disable|off).{0,12}(?:brand\s*(?:signature|footer)|footer|品牌页脚|页脚)/i.test(
      text,
    )
  ) {
    directives.brandFooterMode = 'NEVER';
  } else if (
    !mentionsFooterLogo &&
    /(?:开启|打开|显示|启用|enable|show|on).{0,12}(?:brand\s*(?:signature|footer)|footer|品牌页脚|页脚)/i.test(
      text,
    )
  ) {
    directives.brandFooterMode = 'ALWAYS';
  }

  if (
    /(?:footer\s*logo|页脚\s*(?:logo|标志)).{0,8}(?:隐藏|关闭|不要|hide|off)/i.test(
      text,
    ) ||
    /(?:隐藏|关闭|不要|hide|off).{0,8}(?:footer\s*logo|页脚\s*(?:logo|标志))/i.test(
      text,
    )
  ) {
    directives.footerLogoMode = 'HIDE';
  } else if (
    /(?:footer\s*logo|页脚\s*(?:logo|标志)).{0,8}(?:显示|开启|打开|show|on)/i.test(
      text,
    ) ||
    /(?:显示|开启|打开|show|on).{0,8}(?:footer\s*logo|页脚\s*(?:logo|标志))/i.test(
      text,
    )
  ) {
    directives.footerLogoMode = 'SHOW';
    directives.brandFooterMode = 'ALWAYS';
  }

  if (explicitlyDisablesCornerLogo) {
    directives.logoMode = 'NEVER';
  } else if (explicitlyEnablesCornerLogo) {
    directives.logoMode = 'ALWAYS';
  } else if (
    !mentionsFooterLogo &&
    /(?:不要|关闭|关掉|移除|去掉|无|no|disable|off).{0,12}(?:logo|标志)/i.test(
      text,
    )
  ) {
    directives.logoMode = 'NEVER';
  } else if (
    (!mentionsFooterLogo &&
      /(?:开启|打开|显示|启用|加上|enable|show|on).{0,12}(?:logo|标志)/i.test(
        text,
      )) ||
    /(?:右上|左上|右下|左下|顶部中央|底部中央).{0,8}(?:logo|标志)/i.test(text)
  ) {
    directives.logoMode = 'ALWAYS';
  }

  const placements: Array<
    [RegExp, NonNullable<ImageDirectives['logoPlacement']>]
  > = [
    [/(?:右上|top\s*right)/i, 'TOP_RIGHT'],
    [/(?:左上|top\s*left)/i, 'TOP_LEFT'],
    [/(?:顶部中央|top\s*cent(?:er|re))/i, 'TOP_CENTER'],
    [/(?:右下|bottom\s*right)/i, 'BOTTOM_RIGHT'],
    [/(?:左下|bottom\s*left)/i, 'BOTTOM_LEFT'],
    [/(?:底部中央|bottom\s*cent(?:er|re))/i, 'BOTTOM_CENTER'],
    [/(?:中央右侧|cent(?:er|re)\s*right)/i, 'CENTER_RIGHT'],
    [/(?:中央左侧|cent(?:er|re)\s*left)/i, 'CENTER_LEFT'],
    [/(?:正中央|cent(?:er|re))/i, 'CENTER'],
  ];
  const placement = placements.find(([pattern]) => pattern.test(text))?.[1];

  if (placement) {
    directives.logoPlacement = placement;
  }

  const opacity = text.match(
    /(?:logo\s*opacity|logo透明度|标志透明度)\s*(?:为|是|=|:|：)?\s*(\d{1,3})\s*%/i,
  );
  if (opacity) {
    directives.logoOpacity = Math.min(
      1,
      Math.max(0.2, Number(opacity[1]) / 100),
    );
  }

  const scale = text.match(
    /(?:logo\s*(?:size|scale)|logo大小|标志大小)\s*(?:为|是|=|:|：)?\s*(0\.\d+|1(?:\.\d+)?)/i,
  );
  if (scale) {
    directives.logoScale = Math.min(1.5, Math.max(0.5, Number(scale[1])));
  }

  return directives;
}
