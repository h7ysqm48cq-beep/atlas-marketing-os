import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorHumanOwnerCredentialGuard } from './supervisor-human-owner-credential.guard';

const OWNER_TOKEN = 'server-owned-secret';

describe('SupervisorHumanOwnerCredentialGuard', () => {
  function request(suppliedToken?: string) {
    const headers: Record<string, string> = {};
    if (suppliedToken) {
      headers['x-atlas-supervisor-owner-token'] = suppliedToken;
    }
    return { headers };
  }

  function context(value: ReturnType<typeof request>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => value }),
    } as unknown as ExecutionContext;
  }

  function guard(ownerToken?: string) {
    return new SupervisorHumanOwnerCredentialGuard({
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_OWNER_TOKEN' ? ownerToken : undefined,
      ),
    } as unknown as ConfigService);
  }

  it('injects the server-owned credential when the caller provides none', () => {
    const value = request();

    expect(guard(OWNER_TOKEN).canActivate(context(value))).toBe(true);
    expect(value.headers['x-atlas-supervisor-owner-token']).toBe(OWNER_TOKEN);
  });

  it('overwrites caller-supplied credential with the server-owned credential', () => {
    const value = request('caller-controlled-token');

    expect(guard(OWNER_TOKEN).canActivate(context(value))).toBe(true);
    expect(value.headers['x-atlas-supervisor-owner-token']).toBe(OWNER_TOKEN);
  });

  it('fails closed when the server credential is not configured', () => {
    expect(() => guard().canActivate(context(request()))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard().canActivate(context(request()))).toThrow(
      'supervisor_owner_credential_not_configured',
    );
  });
});
