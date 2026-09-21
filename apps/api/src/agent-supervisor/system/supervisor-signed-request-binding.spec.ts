import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createTestSupervisorAuthority } from '../authority/test-authority';
import {
  SUPERVISOR_SYSTEM_AUDIENCE, SupervisorSystemGuard,
  supervisorSystemCoordinationDigest,
  type SupervisorSystemCoordinationAction,
} from './supervisor-system.guard';
import { SupervisorSignedReviewController } from
  './supervisor-signed-review.controller';

const NOW = new Date('2026-09-22T04:00:00.000Z');
const TASK = 'ATLAS-SYS-140-ALPHA';
const OTHER = 'ATLAS-SYS-140-BRAVO';
const VERSION = '2026-09-22T03:59:00.123Z';

function makeTestContext(handler: 'advance' | 'releaseReady',
  request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => SupervisorSignedReviewController.prototype[handler],
    getClass: () => SupervisorSignedReviewController,
  } as unknown as ExecutionContext;
}

function signer() {
  const authority = createTestSupervisorAuthority();
  const guard = new SupervisorSystemGuard(authority, new Reflector());
  const assertion = (action: SupervisorSystemCoordinationAction,
    body: { taskId: string; expectedTaskVersion?: string },
    overrides: Record<string, unknown> = {}) =>
    authority.sign('SUPERVISOR_SYSTEM', {
      iss: 'atlas.supervisor.control-plane',
      sub: 'atlas:executive-supervisor',
      aud: SUPERVISOR_SYSTEM_AUDIENCE,
      actorType: 'EXECUTIVE_SUPERVISOR',
      tokenType: 'SYSTEM_ASSERTION',
      purpose: 'VERIFICATION_COORDINATION',
      iat: NOW.toISOString(),
      exp: new Date(NOW.getTime() + 60000).toISOString(),
      jti: 'issue140-test-' + action,
      claimEpoch: 0,
      taskId: body.taskId,
      coordinationDigest: supervisorSystemCoordinationDigest(body, action),
      ...overrides,
    });
  const request = (token: string, body: Record<string, unknown>) => ({
    headers: { authorization: 'Bearer ' + token },
    body,
  });
  return { guard, assertion, request };
}

describe('Issue #140 exact-body supervisor coordination HTTP authority', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('accepts a short-lived SIGNED_ADVANCE only for signed task', () => {
    const { guard, assertion, request } = signer();
    const body = { taskId: TASK };
    const http = request(assertion('SIGNED_ADVANCE', body), body);
    expect(guard.canActivate(makeTestContext('advance', http))).toBe(true);
    expect(http).toHaveProperty(
      'supervisorSystemAuthorization.claims.taskId', TASK,
    );
  });

  it('rejects task substitution with a genuine same-purpose assertion', () => {
    const { guard, assertion, request } = signer();
    const token = assertion('SIGNED_ADVANCE', { taskId: TASK });
    expect(() => guard.canActivate(makeTestContext('advance',
      request(token, { taskId: OTHER }),
    ))).toThrow('supervisor_system_coordination_binding_mismatch');
  });

  it('rejects missing task or missing digest despite valid control-plane signature', () => {
    const { guard, assertion, request } = signer();
    const token = assertion('SIGNED_ADVANCE', { taskId: TASK },
      { coordinationDigest: 'f'.repeat(64) });
    expect(() => guard.canActivate(makeTestContext('advance',
      request(token, { taskId: TASK }),
    ))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(makeTestContext('advance',
      request(assertion('SIGNED_ADVANCE', { taskId: TASK }), {}),
    ))).toThrow(ForbiddenException);
  });

  it('accepts signed READY with exact version, but not altered version', () => {
    const { guard, assertion, request } = signer();
    const original = { taskId: TASK, expectedTaskVersion: VERSION };
    const token = assertion('SIGNED_READY', original);
    expect(guard.canActivate(makeTestContext('releaseReady',
      request(token, original),
    ))).toBe(true);
    expect(() => guard.canActivate(makeTestContext('releaseReady',
      request(token, { ...original,
        expectedTaskVersion: '2026-09-22T03:58:00.123Z' }),
    ))).toThrow('supervisor_system_coordination_binding_mismatch');
  });

  it('cannot replay an ADVANCE assertion as READY or vice versa', () => {
    const { guard, assertion, request } = signer();
    const advance = assertion('SIGNED_ADVANCE', { taskId: TASK });
    const ready = assertion('SIGNED_READY',
      { taskId: TASK, expectedTaskVersion: VERSION });
    expect(() => guard.canActivate(makeTestContext('releaseReady',
      request(advance, {
        taskId: TASK, expectedTaskVersion: VERSION,
      }),
    ))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(makeTestContext('advance',
      request(ready, { taskId: TASK }),
    ))).toThrow(ForbiddenException);
  });

  it('rejects missing READY version and a valid but wrong purpose', () => {
    const { guard, assertion, request } = signer();
    const ready = assertion('SIGNED_READY',
      { taskId: TASK, expectedTaskVersion: VERSION });
    expect(() => guard.canActivate(makeTestContext('releaseReady',
      request(ready, { taskId: TASK }),
    ))).toThrow(ForbiddenException);
    const wrongPurpose = assertion('SIGNED_ADVANCE', { taskId: TASK },
      { purpose: 'ADMISSION' });
    expect(() => guard.canActivate(makeTestContext('advance',
      request(wrongPurpose, { taskId: TASK }),
    ))).toThrow(ForbiddenException);
  });

  it('expired token cannot be replayed even with identical body', () => {
    const { guard, assertion, request } = signer();
    const body = { taskId: TASK };
    const token = assertion('SIGNED_ADVANCE', body);
    jest.setSystemTime(new Date(NOW.getTime() + 60001));
    expect(() => guard.canActivate(makeTestContext('advance',
      request(token, body),
    ))).toThrow(UnauthorizedException);
  });
});
