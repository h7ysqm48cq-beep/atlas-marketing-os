import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorRunnerGuard } from './supervisor-runner.guard';

describe('SupervisorRunnerGuard', () => {
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
        key === 'ATLAS_SUPERVISOR_RUNNER_TOKEN' ? configuredToken : undefined,
      ),
    } as unknown as ConfigService;
    return new SupervisorRunnerGuard(config);
  }

  function expectUnauthorized(fn: () => unknown, message: string) {
    expect(fn).toThrow(new UnauthorizedException(message));
  }

  it('fails closed when the runner credential is not configured', () => {
    expectUnauthorized(
      () =>
        guard(undefined).canActivate(
          context({
            'x-atlas-supervisor-runner-token': 'candidate',
            'x-atlas-runner-id':
              'engineering-runner:123e4567-e89b-42d3-a456-426614174000',
          }),
        ),
      'runner_credential_not_configured',
    );
  });

  it('rejects a request with no runner token header', () => {
    expectUnauthorized(
      () =>
        guard('runner-secret').canActivate(
          context({
            'x-atlas-runner-id':
              'engineering-runner:123e4567-e89b-42d3-a456-426614174000',
          }),
        ),
      'runner_credential_required',
    );
  });

  it('rejects an incorrect runner token', () => {
    expectUnauthorized(
      () =>
        guard('runner-secret').canActivate(
          context({
            'x-atlas-supervisor-runner-token': 'wrong-secret',
            'x-atlas-runner-id':
              'engineering-runner:123e4567-e89b-42d3-a456-426614174000',
          }),
        ),
      'runner_credential_invalid',
    );
  });

  it('rejects a request with no runner id', () => {
    expectUnauthorized(
      () =>
        guard('runner-secret').canActivate(
          context({ 'x-atlas-supervisor-runner-token': 'runner-secret' }),
        ),
      'runner_id_required',
    );
  });

  it('rejects a malformed runner id', () => {
    expectUnauthorized(
      () =>
        guard('runner-secret').canActivate(
          context({
            'x-atlas-supervisor-runner-token': 'runner-secret',
            'x-atlas-runner-id': 'engineering-runner:not-a-uuid-v4',
          }),
        ),
      'runner_id_required',
    );
  });

  it('accepts the configured runner token and exact engineering runner id', () => {
    expect(
      guard('runner-secret').canActivate(
        context({
          'x-atlas-supervisor-runner-token': 'runner-secret',
          'x-atlas-runner-id':
            'engineering-runner:123e4567-e89b-42d3-a456-426614174000',
        }),
      ),
    ).toBe(true);
  });

  it('rejects the owner token when presented in the runner header', () => {
    expectUnauthorized(
      () =>
        guard('runner-secret').canActivate(
          context({
            'x-atlas-supervisor-runner-token': 'owner-secret',
            'x-atlas-runner-id':
              'engineering-runner:123e4567-e89b-42d3-a456-426614174000',
          }),
        ),
      'runner_credential_invalid',
    );
  });

  it('rejects the CI token when presented in the runner header', () => {
    expectUnauthorized(
      () =>
        guard('runner-secret').canActivate(
          context({
            'x-atlas-supervisor-runner-token': 'ci-secret',
            'x-atlas-runner-id':
              'engineering-runner:123e4567-e89b-42d3-a456-426614174000',
          }),
        ),
      'runner_credential_invalid',
    );
  });
});
