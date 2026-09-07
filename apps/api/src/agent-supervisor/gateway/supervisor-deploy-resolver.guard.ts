import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEPLOY_RESOLVER_TOKEN_HEADER =
  'x-atlas-supervisor-deploy-resolver-token';

@Injectable()
export class SupervisorDeployResolverGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>(
      'ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN',
    );
    if (!configured) {
      throw new UnauthorizedException(
        'deploy_resolver_credential_not_configured',
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const supplied = request.headers?.[DEPLOY_RESOLVER_TOKEN_HEADER];
    if (typeof supplied !== 'string' || !supplied) {
      throw new UnauthorizedException('deploy_resolver_credential_required');
    }

    const expectedDigest = this.digest(configured);
    const suppliedDigest = this.digest(supplied);
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('deploy_resolver_credential_invalid');
    }

    return true;
  }

  private digest(value: string) {
    return createHash('sha256').update(value, 'utf8').digest();
  }
}
