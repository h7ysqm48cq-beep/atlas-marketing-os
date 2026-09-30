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

const WORKER_ROLES: SupervisorWorkerRole[] = [
  'engineering',
  'frontend',
  'backend',
  'database',
  'qa',
  'infra',
  'verifier',
];

const WORKER_ROLE_SET = new Set<SupervisorWorkerRole>(WORKER_ROLES);

function roleTokenKey(role: SupervisorWorkerRole): string {
  return `ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_${role.toUpperCase()}_TOKEN`;
}

type BootstrapRequest = {
  headers?: { authorization?: unknown };
  supervisorWorkerBootstrapRole?: SupervisorWorkerRole;
};

@Injectable()
export class SupervisorWorkerBootstrapGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const legacyToken = this.config.get<string>(
      'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN',
    );
    const legacyRole = this.config.get<string>(
      'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE',
    );

    if (
      legacyToken &&
      (!legacyRole || !WORKER_ROLE_SET.has(legacyRole as SupervisorWorkerRole))
    ) {
      throw new ForbiddenException('worker_bootstrap_role_invalid');
    }

    const roleTokens = WORKER_ROLES.flatMap((role) => {
      const token = this.config.get<string>(roleTokenKey(role));
      return token ? [{ role, token }] : [];
    });
    const configured = [
      ...(legacyToken && legacyRole
        ? [{ role: legacyRole as SupervisorWorkerRole, token: legacyToken }]
        : []),
      ...roleTokens,
    ];
    if (configured.length === 0) {
      throw new ForbiddenException('worker_bootstrap_not_configured');
    }

    for (let index = 0; index < configured.length; index += 1) {
      for (let other = index + 1; other < configured.length; other += 1) {
        if (
          configured[index].role !== configured[other].role &&
          this.equalSecret(configured[index].token, configured[other].token)
        ) {
          throw new ForbiddenException('worker_bootstrap_tokens_not_separated');
        }
      }
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
    const matched = configured.find(({ token }) =>
      this.equalSecret(suppliedToken, token),
    );
    if (!matched) {
      throw new UnauthorizedException('worker_bootstrap_invalid');
    }

    request.supervisorWorkerBootstrapRole = matched.role;
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
