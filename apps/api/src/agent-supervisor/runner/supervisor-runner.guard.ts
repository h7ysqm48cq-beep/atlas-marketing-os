import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RUNNER_TOKEN_HEADER = 'x-atlas-supervisor-runner-token';
const RUNNER_ID_HEADER = 'x-atlas-runner-id';
const RUNNER_ID_PATTERN =
  /^engineering-runner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class SupervisorRunnerGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('ATLAS_SUPERVISOR_RUNNER_TOKEN');
    if (!configured) {
      throw new UnauthorizedException('runner_credential_not_configured');
    }

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const runnerId = request.headers?.[RUNNER_ID_HEADER];
    if (typeof runnerId !== 'string' || !RUNNER_ID_PATTERN.test(runnerId)) {
      throw new UnauthorizedException('runner_id_required');
    }

    const supplied = request.headers?.[RUNNER_TOKEN_HEADER];
    if (typeof supplied !== 'string' || !supplied) {
      throw new UnauthorizedException('runner_credential_required');
    }

    const expectedDigest = this.credentialDigest(configured, runnerId);
    const suppliedDigest = Buffer.from(supplied, 'hex');
    if (
      suppliedDigest.length !== expectedDigest.length ||
      !timingSafeEqual(expectedDigest, suppliedDigest)
    ) {
      throw new UnauthorizedException('runner_credential_invalid');
    }

    return true;
  }

  private credentialDigest(configured: string, runnerId: string) {
    return createHmac('sha256', configured).update(runnerId, 'utf8').digest();
  }
}
