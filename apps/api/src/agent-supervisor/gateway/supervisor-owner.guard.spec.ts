import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorOwnerGuard } from './supervisor-owner.guard';

describe('SupervisorOwnerGuard', () => {
  function context(method: string, token?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers: token
            ? { 'x-atlas-supervisor-owner-token': token }
            : {},
          user: { id: 'authenticated-user' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function guard(configuredToken?: string) {
    const config = {
      get: jest.fn().mockReturnValue(configuredToken),
    } as unknown as ConfigService;
    return new SupervisorOwnerGuard(config);
  }

  it('allows read-only GET requests without an owner credential', () => {
    expect(guard(undefined).canActivate(context('GET'))).toBe(true);
  });

  it('fails closed for mutations when the owner credential is not configured', () => {
    expect(() => guard(undefined).canActivate(context('POST', 'candidate'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a mutation with no owner token header', () => {
    expect(() => guard('owner-secret').canActivate(context('POST'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an incorrect owner token', () => {
    expect(() =>
      guard('owner-secret').canActivate(context('POST', 'wrong-secret')),
    ).toThrow(UnauthorizedException);
  });

  it('accepts a mutation only with the exact configured owner token', () => {
    expect(
      guard('owner-secret').canActivate(context('POST', 'owner-secret')),
    ).toBe(true);
  });
});
