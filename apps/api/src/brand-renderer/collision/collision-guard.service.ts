import { Injectable } from '@nestjs/common';

@Injectable()
export class CollisionGuardService {

  check(input: {
    width: number;
    height: number;
    footerEnabled?: boolean;
    logoEnabled?: boolean;
  }) {

    return {
      footerArea:
        input.footerEnabled
          ? 'reserved'
          : 'free',

      logoArea:
        input.logoEnabled
          ? 'reserved'
          : 'free',
    };

  }

}
