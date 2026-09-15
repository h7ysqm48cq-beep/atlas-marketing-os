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
  'engineering', 'frontend', 'backend', 'database', 'qa', 'infra',
]);
const ROLE_TOKEN_KEYS: ReadonlyArray<[SupervisorWorkerRole, string]> = [
  ['engineering', 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ENGINEERING_TOKEN'],
  ['frontend', 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_FRONTEND_TOKEN'],
  ['backend', 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_BACKEND_TOKEN'],
  ['database', 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_DATABASE_TOKEN'],
  ['qa', 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_QA_TOKEN'],
  ['infra', 'ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_INFRA_TOKEN'],
];

type BootstrapRequest = {
  headers?: { authorization?: unknown };
  supervisorWorkerBootstrapRole?: SupervisorWorkerRole;
};

type BootstrapIdentity = { token: string; role: SupervisorWorkerRole };

@Injectable()
export class SupervisorWorkerBootstrapGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const identities = this.configuredIdentities();
    if (identities.length === 0) {
      throw new ForbiddenException('worker_bootstrap_not_configured');
    }

    const request = context.switchToHttp().getRequest<BootstrapRequest>();
    const authorization = request.headers?.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('worker_bootstrap_required');
    }

    const suppliedToken = authorization.slice('Bearer '.length);
    const reserved = [
      this.config.get<string>('ATLAS_SUPERVISOR_OWNER_TOKEN'),
      this.config.get<string>('ATLAS_SUPERVISOR_CI_TOKEN'),
    ].filter((value): value is string => Boolean(value));
    if (reserved.some((token) => this.equalSecret(suppliedToken, token))) {
      throw new UnauthorizedException('worker_bootstrap_invalid');
    }

    const matchedRoles = [
      ...new Set(
        identities
          .filter((identity) => this.equalSecret(suppliedToken, identity.token))
          .map((identity) => identity.role),
      ),
    ];
    if (matchedRoles.length === 0) {
      throw new UnauthorizedException('worker_bootstrap_invalid');
    }
    if (matchedRoles.length > 1) {
      throw new ForbiddenException('worker_bootstrap_credential_ambiguous');
    }

    request.supervisorWorkerBootstrapRole = matchedRoles[0];
    return true;
  }

  private configuredIdentities(): BootstrapIdentity[] {
    const identities: BootstrapIdentity[] = [];
    const legacyToken = this.config.get<string>('ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN');
    const legacyRole = this.config.get<string>('ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE');
    if (legacyToken || legacyRole) {
      if (!legacyToken) throw new ForbiddenException('worker_bootstrap_not_configured');
      if (!legacyRole || !WORKER_ROLES.has(legacyRole as SupervisorWorkerRole)) {
        throw new ForbiddenException('worker_bootstrap_role_invalid');
      }
      identities.push({ token: legacyToken, role: legacyRole as SupervisorWorkerRole });
    }
    for (const [role, key] of ROLE_TOKEN_KEYS) {
      const token = this.config.get<string>(key);
      if (token) identities.push({ token, role });
    }
    return identities;
  }

  private equalSecret(supplied: string, configured: string): boolean {
    const suppliedBytes = Buffer.from(supplied);
    const configuredBytes = Buffer.from(configured);
    if (suppliedBytes.length !== configuredBytes.length) return false;
    return timingSafeEqual(suppliedBytes, configuredBytes);
  }
}
