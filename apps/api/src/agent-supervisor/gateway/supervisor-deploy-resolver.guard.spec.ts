import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorDeployResolverGuard } from './supervisor-deploy-resolver.guard';

describe('SupervisorDeployResolverGuard', () => {
  function context(headers: Record<string, string> = {}): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext;
  }

  function guard(configuredToken?: string) {
    const config = {
      get: jest.fn((key: string) =>
        key === 'ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN'
          ? configuredToken
          : undefined,
      ),
    } as unknown as ConfigService;
    return new SupervisorDeployResolverGuard(config);
  }

  function expectUnauthorized(fn: () => unknown, message: string) {
    expect(fn).toThrow(new UnauthorizedException(message));
  }

  it('fails closed when the deploy resolver credential is not configured', () => {
    expectUnauthorized(
      () =>
        guard(undefined).canActivate(
          context({ 'x-atlas-supervisor-deploy-resolver-token': 'candidate' }),
        ),
      'deploy_resolver_credential_not_configured',
    );
  });

  it('rejects a request with no deploy resolver token header', () => {
    expectUnauthorized(
      () => guard('resolver-secret').canActivate(context()),
      'deploy_resolver_credential_required',
    );
  });

  it('rejects an incorrect deploy resolver token', () => {
    expectUnauthorized(
      () =>
        guard('resolver-secret').canActivate(
          context({
            'x-atlas-supervisor-deploy-resolver-token': 'wrong-secret',
          }),
        ),
      'deploy_resolver_credential_invalid',
    );
  });

  it('accepts only the exact configured deploy resolver token', () => {
    expect(
      guard('resolver-secret').canActivate(
        context({
          'x-atlas-supervisor-deploy-resolver-token': 'resolver-secret',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a CI token header alone', () => {
    expectUnauthorized(
      () =>
        guard('resolver-secret').canActivate(
          context({ 'x-atlas-supervisor-ci-token': 'ci-secret' }),
        ),
      'deploy_resolver_credential_required',
    );
  });

  it('rejects owner and runner token headers', () => {
    const alternateHeaders: Array<Record<string, string>> = [
      { 'x-atlas-supervisor-owner-token': 'owner-secret' },
      { 'x-atlas-supervisor-runner-token': 'runner-secret' },
    ];
    for (const headers of alternateHeaders) {
      expectUnauthorized(
        () => guard('resolver-secret').canActivate(context(headers)),
        'deploy_resolver_credential_required',
      );
    }
  });
});
