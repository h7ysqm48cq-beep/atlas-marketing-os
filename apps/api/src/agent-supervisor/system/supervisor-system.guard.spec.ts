import type { ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import {
  SUPERVISOR_SYSTEM_AUDIENCE,
  SupervisorSystemGuard,
  supervisorSystemAdmissionDigest,
  type SupervisorSystemAdmissionRequest,
} from './supervisor-system.guard';

function admission(): SupervisorSystemAdmissionRequest {
  return {
    admissionId: '11111111-2222-3333-4444-555555555555',
    task: {
      objective: 'Automate exact admission',
      owner: 'engineering',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: ['merge', 'deploy_production'],
      dependsOn: [],
      acceptance: ['exact scope'],
    },
    frozenBaseSha: 'a'.repeat(40),
  };
}

function context(
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

function token(
  input: SupervisorSystemAdmissionRequest,
  overrides: Record<string, unknown> = {},
) {
  const authority = createTestSupervisorAuthority();
  const now = new Date('2026-09-18T10:00:00.000Z');
  const assertion = authority.sign('SUPERVISOR_SYSTEM', {
    iss: 'atlas.supervisor.control-plane',
    sub: 'atlas:executive-supervisor',
    aud: SUPERVISOR_SYSTEM_AUDIENCE,
    actorType: 'EXECUTIVE_SUPERVISOR',
    tokenType: 'SYSTEM_ASSERTION',
    purpose: 'ADMISSION',
    iat: now.toISOString(),
    exp: new Date(now.getTime() + 60_000).toISOString(),
    jti: 'system-admission-jti',
    claimEpoch: 0,
    admissionId: input.admissionId.toLowerCase(),
    admissionDigest: supervisorSystemAdmissionDigest(input),
    ...overrides,
  });
  return { authority, assertion, now };
}

describe('SupervisorSystemGuard', () => {
  it('accepts an exact Executive Supervisor admission assertion', () => {
    const input = admission();
    const { authority, assertion, now } = token(input);
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('ADMISSION'),
    } as unknown as Reflector;
    const guard = new SupervisorSystemGuard(authority, reflector);
    const request = {
      headers: {
        authorization: `Bearer ${assertion}`,
      },
      body: input,
    };

    jest.useFakeTimers().setSystemTime(now);
    try {
      expect(guard.canActivate(context(request))).toBe(true);
      expect(request).toHaveProperty(
        'supervisorSystemAuthorization.claims.actorType',
        'EXECUTIVE_SUPERVISOR',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a missing system assertion', () => {
    const authority = createTestSupervisorAuthority();
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('ADMISSION'),
    } as unknown as Reflector;
    const guard = new SupervisorSystemGuard(authority, reflector);

    expect(() =>
      guard.canActivate(
        context({
          headers: {},
          body: admission(),
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects admission body drift against the signed digest', () => {
    const signedInput = admission();
    const { authority, assertion, now } = token(signedInput);
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('ADMISSION'),
    } as unknown as Reflector;
    const guard = new SupervisorSystemGuard(authority, reflector);
    const changed = {
      ...signedInput,
      frozenBaseSha: 'b'.repeat(40),
    };

    jest.useFakeTimers().setSystemTime(now);
    try {
      expect(() =>
        guard.canActivate(
          context({
            headers: {
              authorization: `Bearer ${assertion}`,
            },
            body: changed,
          }),
        ),
      ).toThrow(ForbiddenException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a system assertion with a non-admission purpose', () => {
    const input = admission();
    const { authority, assertion, now } = token(input, {
      purpose: 'DISPATCH',
    });
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('ADMISSION'),
    } as unknown as Reflector;
    const guard = new SupervisorSystemGuard(authority, reflector);

    jest.useFakeTimers().setSystemTime(now);
    try {
      expect(() =>
        guard.canActivate(
          context({
            headers: {
              authorization: `Bearer ${assertion}`,
            },
            body: input,
          }),
        ),
      ).toThrow(ForbiddenException);
    } finally {
      jest.useRealTimers();
    }
  });
});
