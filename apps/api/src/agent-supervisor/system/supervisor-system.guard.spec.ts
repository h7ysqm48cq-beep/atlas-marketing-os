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
  supervisorSystemVerificationAdmissionDigest,
  type SupervisorSystemAdmissionRequest,
  type SupervisorSystemVerificationAdmissionRequest,
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

function verificationAdmission(): SupervisorSystemVerificationAdmissionRequest {
  return {
    admissionId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
    task: {
      objective: `Verify immutable candidate base ${'a'.repeat(40)} head ${'b'.repeat(40)}`,
      owner: 'engineering',
      allowedPaths: ['apps/api/src/example.ts'],
      forbiddenActions: [
        'merge',
        'deploy_production',
        'run_migration',
        'change_runtime_config',
      ],
      dependsOn: [],
      acceptance: ['exact scope'],
    },
    candidateBaseSha: 'a'.repeat(40),
    candidateHeadSha: 'b'.repeat(40),
    productionBaselineSha: 'a'.repeat(40),
    targetBranch: 'production/atlas',
    changedPaths: ['apps/api/src/example.ts'],
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

function verificationToken(
  input: SupervisorSystemVerificationAdmissionRequest,
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
    purpose: 'VERIFICATION_COORDINATION',
    iat: now.toISOString(),
    exp: new Date(now.getTime() + 60_000).toISOString(),
    jti: 'system-verification-admission-jti',
    claimEpoch: 0,
    admissionId: input.admissionId.toLowerCase(),
    admissionDigest: supervisorSystemVerificationAdmissionDigest(input),
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

  it('accepts an exact verification-coordination assertion', () => {
    const input = verificationAdmission();
    const { authority, assertion, now } = verificationToken(input);
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue('VERIFICATION_COORDINATION'),
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
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects verification candidate drift against the signed digest', () => {
    const signedInput = verificationAdmission();
    const { authority, assertion, now } =
      verificationToken(signedInput);
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue('VERIFICATION_COORDINATION'),
    } as unknown as Reflector;
    const guard = new SupervisorSystemGuard(authority, reflector);
    const changed = {
      ...signedInput,
      candidateHeadSha: 'c'.repeat(40),
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
