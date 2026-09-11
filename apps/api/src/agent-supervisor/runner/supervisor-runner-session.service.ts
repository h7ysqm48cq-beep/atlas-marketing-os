import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const RUNNER_ID_PATTERN =
  /^engineering-runner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SupervisorRunnerSessionClaims = {
  version: 1;
  runnerId: string;
  issuedAt: string;
  expiresAt: string;
};

export type IssuedSupervisorRunnerSession = SupervisorRunnerSessionClaims & {
  token: string;
};

@Injectable()
export class SupervisorRunnerSessionService {
  constructor(private readonly config: ConfigService) {}

  issue(
    now = new Date(),
    ttlMs = DEFAULT_TTL_MS,
  ): IssuedSupervisorRunnerSession {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new UnauthorizedException('runner_session_invalid_expiry');
    }
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const claims: SupervisorRunnerSessionClaims = {
      version: 1,
      runnerId: `engineering-runner:${randomUUID()}`,
      issuedAt,
      expiresAt,
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
      'base64url',
    );
    return { ...claims, token: `${payload}.${this.sign(payload)}` };
  }

  verify(token: string, now = new Date()): SupervisorRunnerSessionClaims {
    const [payload, signature] = token?.split('.') ?? [];
    if (!payload || !signature) {
      throw new UnauthorizedException('runner_session_invalid');
    }
    const expected = Buffer.from(this.sign(payload), 'base64url');
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'base64url');
    } catch {
      throw new UnauthorizedException('runner_session_invalid');
    }
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException('runner_session_invalid');
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('runner_session_invalid');
    }
    if (!this.isClaims(value)) {
      throw new UnauthorizedException('runner_session_invalid');
    }
    if (now.getTime() >= Date.parse(value.expiresAt)) {
      throw new UnauthorizedException('runner_session_expired');
    }
    return value;
  }

  private sign(payload: string): string {
    const key = this.config.get<string>(
      'ATLAS_SUPERVISOR_RUNNER_SESSION_SIGNING_KEY',
    );
    if (!key) {
      throw new ServiceUnavailableException(
        'runner_session_signing_material_unavailable',
      );
    }
    return createHmac('sha256', key)
      .update(payload, 'utf8')
      .digest('base64url');
  }

  private isClaims(value: unknown): value is SupervisorRunnerSessionClaims {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const claims = value as Partial<SupervisorRunnerSessionClaims>;
    return (
      claims.version === 1 &&
      typeof claims.runnerId === 'string' &&
      RUNNER_ID_PATTERN.test(claims.runnerId) &&
      typeof claims.issuedAt === 'string' &&
      Number.isFinite(Date.parse(claims.issuedAt)) &&
      typeof claims.expiresAt === 'string' &&
      Number.isFinite(Date.parse(claims.expiresAt))
    );
  }
}
