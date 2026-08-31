import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorCiGuard } from './supervisor-ci.guard';

describe('SupervisorCiGuard', () => {
  function context(token?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: token
            ? { 'x-atlas-supervisor-ci-token': token }
            : {},
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function guard(configuredToken?: string) {
    const config = {
      get: jest.fn().mockReturnValue(configuredToken),
    } as unknown as ConfigService;
    return new SupervisorCiGuard(config);
  }

  it('fails closed when the CI credential is not configured', () => {
    expect(() => guard(undefined).canActivate(context('candidate'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no CI token header', () => {
    expect(() => guard('supervisor-secret').canActivate(context())).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an incorrect CI token', () => {
    expect(() =>
      guard('supervisor-secret').canActivate(context('wrong-secret')),
    ).toThrow(UnauthorizedException);
  });

  it('accepts only the exact configured CI token', () => {
    expect(
      guard('supervisor-secret').canActivate(context('supervisor-secret')),
    ).toBe(true);
  });
});
