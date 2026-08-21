import { Injectable } from '@nestjs/common';

@Injectable()
export class FooterRendererService {

  async render(input: {
    image: Buffer;
    enabled?: boolean;
    text?: string | null;
  }): Promise<Buffer> {

    if (!input.enabled) {
      return input.image;
    }

    /*
      Footer signature rendering engine.

      Future:
      - official brand footer asset
      - typography rules
      - safe area protection
      - collision detection
    */

    return input.image;
  }

}
