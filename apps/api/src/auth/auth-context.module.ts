import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthContextService } from './auth-context.service';
import { WorkspaceScopeService } from './workspace-scope.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuthContextService, WorkspaceScopeService],
  exports: [AuthContextService, WorkspaceScopeService],
})
export class AuthContextModule {}
