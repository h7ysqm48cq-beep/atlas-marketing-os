import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupervisorWorkerRole } from '../execution/supervisor-execution.types';

const WORKER_ROLES = new Set<SupervisorWorkerRole>([
  'engineering',
  'frontend',
  'backend',
  'database',
  'qa',
  'infra',
]);

type BootstrapRequest = {
  headers?: { authorization?: unknown };
  supervisorWorkerBootstrapRole?: SupervisorWorkerRole;
};

@Injectable()
export class SupervisorWorkerBootstrapGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const configuredToken = this.config.get<string>(
      'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN',
    );
    if (!configuredToken) {
      throw new ForbiddenException('worker_bootstrap_not_configured');
    }

    const configuredRole = this.config.get<string>(
      'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE',
    );
    if (!configuredRole || !WORKER_ROLES.has(configuredRole as SupervisorWorkerRole)) {
      throw new ForbiddenException('worker_bootstrap_role_invalid');
    }

    const request = context.switchToHttp().getRequest<BootstrapRequest>();
    const authorization = request.headers?.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      throw new UnauthorizedException('worker_bootstrap_required');
    }

    const suppliedToken = authorization.slice('Bearer '.length);
    if (!this.equalSecret(suppliedToken, configuredToken)) {
      throw new UnauthorizedException('worker_bootstrap_invalid');
    }

    request.supervisorWorkerBootstrapRole = configuredRole as SupervisorWorkerRole;
    return true;
  }

  private equalSecret(supplied: string, configured: string): boolean {
    const suppliedBytes = Buffer.from(supplied);
    const configuredBytes = Buffer.from(configured);
    if (suppliedBytes.length !== configuredBytes.length) {
      return false;
    }
    return timingSafeEqual(suppliedBytes, configuredBytes);
  }
}
