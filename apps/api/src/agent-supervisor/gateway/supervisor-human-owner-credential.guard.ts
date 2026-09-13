import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OWNER_TOKEN_HEADER = 'x-atlas-supervisor-owner-token';

@Injectable()
export class SupervisorHumanOwnerCredentialGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const ownerToken = this.config.get<string>('ATLAS_SUPERVISOR_OWNER_TOKEN');
    if (!ownerToken) {
      throw new UnauthorizedException(
        'supervisor_owner_credential_not_configured',
      );
    }

    request.headers[OWNER_TOKEN_HEADER] = ownerToken;
    return true;
  }
}
