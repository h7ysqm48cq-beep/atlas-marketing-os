import { Global, Module } from '@nestjs/common';
import { DateTimeService } from './datetime.service';

@Global()
@Module({
  providers: [
    DateTimeService,
  ],
  exports: [
    DateTimeService,
  ],
})
export class CommonModule {}
