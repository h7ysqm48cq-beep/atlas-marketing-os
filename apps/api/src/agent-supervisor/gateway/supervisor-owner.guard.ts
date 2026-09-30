import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OWNER_TOKEN_HEADER = 'x-atlas-supervisor-owner-token';
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SupervisorOwnerGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers?: Record<string, string | string[] | undefined>;
      user?: { id?: string };
    }>();

    const method = (request.method ?? '').toUpperCase();
    if (READ_ONLY_METHODS.has(method)) {
      return true;
    }

    if (!request.user?.id) {
      throw new UnauthorizedException('supervisor_authenticated_owner_required');
    }

    const configured = this.config.get<string>('ATLAS_SUPERVISOR_OWNER_TOKEN');
    if (!configured) {
      throw new UnauthorizedException('supervisor_owner_credential_not_configured');
    }

    const supplied = request.headers?.[OWNER_TOKEN_HEADER];
    if (typeof supplied !== 'string' || !supplied) {
      throw new UnauthorizedException('supervisor_owner_credential_required');
    }

    const expectedDigest = this.digest(configured);
    const suppliedDigest = this.digest(supplied);
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('supervisor_owner_credential_invalid');
    }

    return true;
  }

  private digest(value: string) {
    return createHash('sha256').update(value, 'utf8').digest();
  }
}
