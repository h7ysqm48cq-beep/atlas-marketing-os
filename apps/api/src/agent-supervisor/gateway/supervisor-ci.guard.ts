import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CI_TOKEN_HEADER = 'x-atlas-supervisor-ci-token';

@Injectable()
export class SupervisorCiGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('ATLAS_SUPERVISOR_CI_TOKEN');
    if (!configured) {
      throw new UnauthorizedException('supervisor_ci_credential_not_configured');
    }

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const supplied = request.headers?.[CI_TOKEN_HEADER];
    if (typeof supplied !== 'string' || !supplied) {
      throw new UnauthorizedException('supervisor_ci_credential_required');
    }

    const expectedDigest = this.digest(configured);
    const suppliedDigest = this.digest(supplied);
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('supervisor_ci_credential_invalid');
    }

    return true;
  }

  private digest(value: string) {
    return createHash('sha256').update(value, 'utf8').digest();
  }
}
