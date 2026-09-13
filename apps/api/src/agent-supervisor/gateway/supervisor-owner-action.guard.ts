import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OWNER_ACTION_HEADER = 'x-atlas-supervisor-owner-action';
const OWNER_TOKEN_HEADER = 'x-atlas-supervisor-owner-token';
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SupervisorOwnerActionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers: Record<string, string | string[] | undefined>;
      user?: { id?: string };
    }>();

    if (READ_ONLY_METHODS.has((request.method ?? '').toUpperCase())) {
      return true;
    }

    if (!request.user?.id) {
      throw new UnauthorizedException(
        'supervisor_authenticated_owner_required',
      );
    }

    const ownerId = this.config.get<string>('ATLAS_SUPERVISOR_OWNER_USER_ID');
    if (!ownerId) {
      throw new UnauthorizedException(
        'supervisor_owner_identity_not_configured',
      );
    }
    if (request.user.id !== ownerId) {
      throw new UnauthorizedException(
        'supervisor_authenticated_owner_required',
      );
    }

    if (request.headers[OWNER_ACTION_HEADER] !== '1') {
      throw new UnauthorizedException('supervisor_owner_action_required');
    }

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
