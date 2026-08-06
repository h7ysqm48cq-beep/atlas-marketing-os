import {
  Module,
} from '@nestjs/common';

import {
  EngineeringController,
} from './engineering.controller';
import {
  EngineeringService,
} from './engineering.service';

@Module({
  controllers: [
    EngineeringController,
  ],
  providers: [
    EngineeringService,
  ],
  exports: [
    EngineeringService,
  ],
})
export class EngineeringModule {}
