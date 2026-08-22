import { parseCopilotImageDirectives } from './copilot-image-directives';

describe('parseCopilotImageDirectives', () => {
  it('parses an aspect ratio without forcing a fixed resolution', () => {
    expect(
      parseCopilotImageDirectives(
        '请生成 16:9 图片，关闭文字叠加，关闭页脚，关闭 Logo',
      ),
    ).toEqual(
      expect.objectContaining({
        aspectRatio: '16:9',
        textOverlayMode: 'NEVER',
        brandFooterMode: 'NEVER',
        logoMode: 'NEVER',
      }),
    );
  });

  it('prefers an exact requested resolution and explicit user copy', () => {
    expect(
      parseCopilotImageDirectives(
        '尺寸 2048×2048，文字叠加「限时优惠」，左下 Logo，Logo大小 1.2，Logo透明度 75%',
      ),
    ).toEqual(
      expect.objectContaining({
        outputWidth: 2048,
        outputHeight: 2048,
        textOverlayMode: 'ALWAYS',
        textOverlayText: '限时优惠',
        logoMode: 'ALWAYS',
        logoPlacement: 'BOTTOM_LEFT',
        logoScale: 1.2,
        logoOpacity: 0.75,
      }),
    );
  });

  it('controls the footer logo without changing the independent corner logo', () => {
    expect(
      parseCopilotImageDirectives('开启页脚 Logo，Footer 保持显示'),
    ).toEqual(
      expect.objectContaining({
        footerLogoMode: 'SHOW',
        brandFooterMode: 'ALWAYS',
      }),
    );
    expect(
      parseCopilotImageDirectives('开启页脚 Logo，Footer 保持显示').logoMode,
    ).toBeUndefined();
  });

  it('controls footer and corner logos independently in one instruction', () => {
    expect(
      parseCopilotImageDirectives(
        '隐藏 footer logo，同时 show corner logo 放右上角',
      ),
    ).toEqual(
      expect.objectContaining({
        footerLogoMode: 'HIDE',
        logoMode: 'ALWAYS',
        logoPlacement: 'TOP_RIGHT',
      }),
    );
  });

  it('does not mistake a normal time for an image aspect ratio', () => {
    expect(
      parseCopilotImageDirectives('今晚 20:30 发布这张图片').aspectRatio,
    ).toBeUndefined();
  });
});
