import { Injectable } from "@nestjs/common";
import sharp from "sharp";

@Injectable()
export class LogoOverlayService {
  async overlay(options: {
    image: Buffer;
    logo: Buffer;
    width: number;
    height: number;
  }) {
    const targetLogoWidth = Math.max(
      72,
      Math.min(
        140,
        Math.round(options.width * 0.09),
      ),
    );

    const resizedLogo =
      await sharp(options.logo)
        .resize({
          width: targetLogoWidth,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

    const metadata =
      await sharp(resizedLogo).metadata();

    const logoWidth =
      metadata.width ??
      targetLogoWidth;

    const logoHeight =
      metadata.height ??
      Math.round(targetLogoWidth * 0.4);

    const margin =
      Math.max(
        24,
        Math.round(options.height * 0.025),
      );

    const left =
      Math.round(
        (options.width - logoWidth) / 2,
      );

    const top =
      options.height -
      logoHeight -
      margin;

    return sharp(options.image)
      .composite([
        {
          input: resizedLogo,
          left,
          top,
        },
      ])
      .png()
      .toBuffer();
  }
}
