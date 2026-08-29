import { Global, Module } from '@nestjs/common';
import { AuthContextService } from './auth-context.service';

@Global()
@Module({
  providers: [AuthContextService],
  exports: [AuthContextService],
})
export class AuthContextModule {}
