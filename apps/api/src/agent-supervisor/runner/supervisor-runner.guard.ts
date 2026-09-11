import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import {
  SupervisorRunnerSessionService,
  type SupervisorRunnerSessionClaims,
} from './supervisor-runner-session.service';

const RUNNER_TOKEN_HEADER = 'x-atlas-supervisor-runner-token';

export type SupervisorRunnerRequest = {
  headers?: Record<string, string | string[] | undefined>;
  atlasRunnerId?: string;
  atlasRunnerSession?: SupervisorRunnerSessionClaims;
};

function header(request: SupervisorRunnerRequest, name: string): string | null {
  const value = request.headers?.[name];
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class SupervisorRunnerBootstrapGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('ATLAS_SUPERVISOR_RUNNER_TOKEN');
    if (!configured) {
      throw new UnauthorizedException('runner_bootstrap_credential_not_configured');
    }
    const request = context
      .switchToHttp()
      .getRequest<SupervisorRunnerRequest>();
    const supplied = header(request, RUNNER_TOKEN_HEADER);
    if (!supplied) {
      throw new UnauthorizedException('runner_bootstrap_credential_required');
    }
    const expected = Buffer.from(configured, 'utf8');
    const actual = Buffer.from(supplied, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('runner_bootstrap_credential_invalid');
    }
    return true;
  }
}

@Injectable()
export class SupervisorRunnerSessionGuard implements CanActivate {
  constructor(private readonly sessions: SupervisorRunnerSessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<SupervisorRunnerRequest>();
    const authorization = header(request, 'authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('runner_session_required');
    }
    const session = this.sessions.verify(authorization.slice('Bearer '.length));
    request.atlasRunnerSession = session;
    request.atlasRunnerId = session.runnerId;
    return true;
  }
}

// Compatibility name for integrations that imported the pre-R2 guard.
@Injectable()
export class SupervisorRunnerGuard extends SupervisorRunnerSessionGuard {}
