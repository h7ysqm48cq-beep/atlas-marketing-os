import sharp from 'sharp';
import { ImagePostProcessorService } from './image-post-processor.service';

describe('ImagePostProcessorService', () => {
  const service = new ImagePostProcessorService();

  it('does not render any main overlay when explicit user copy is empty', async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 4,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();

    const output = await service.process(
      source,
      {
        textOverlayEnabled: true,
        brandFooterEnabled: false,
      },
      '',
    );
    const sourcePixels = await sharp(source).raw().toBuffer();
    const outputPixels = await sharp(output).raw().toBuffer();

    expect(outputPixels).toEqual(sourcePixels);
  });

  it('composites explicit overlay copy and the official footer logo into the pixels', async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 4,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();
    const logo = await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 4,
        background: {
          r: 255,
          g: 0,
          b: 0,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();

    const output = await service.process(
      source,
      {
        textOverlayEnabled: true,
        brandFooterEnabled: true,
        footerText: 'Official footer',
        footerPosition: 'bottom-center',
        footerStyle: 'premium',
        brandLogo: logo,
        logoEnabled: true,
      },
      'User headline',
    );
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    let redLogoPixels = 0;
    let nonBlackPixels = 0;

    for (let index = 0; index < pixels.length; index += 3) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];

      if (red > 200 && green < 40 && blue < 40) {
        redLogoPixels += 1;
      }

      if (red > 0 || green > 0 || blue > 0) {
        nonBlackPixels += 1;
      }
    }

    expect(redLogoPixels).toBeGreaterThan(0);
    expect(nonBlackPixels).toBeGreaterThan(redLogoPixels);
  });

  it('renders an explicitly enabled footer logo without requiring footer text', async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const logo = await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const output = await service.process(
      source,
      {
        textOverlayEnabled: false,
        brandFooterEnabled: true,
        footerText: '',
        footerPosition: 'bottom-center',
        footerStyle: 'minimal',
        brandLogo: logo,
        logoEnabled: true,
      },
      '',
    );
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    let redLogoPixels = 0;

    for (let index = 0; index < pixels.length; index += 3) {
      if (
        pixels[index] > 200 &&
        pixels[index + 1] < 40 &&
        pixels[index + 2] < 40
      ) {
        redLogoPixels += 1;
      }
    }

    expect(redLogoPixels).toBeGreaterThan(0);
  });
});
