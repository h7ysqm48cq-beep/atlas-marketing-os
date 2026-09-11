import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  SupervisorRunnerBootstrapGuard,
  SupervisorRunnerSessionGuard,
} from './supervisor-runner.guard';
import { SupervisorRunnerSessionService } from './supervisor-runner-session.service';

const NOW = new Date('2026-09-08T00:00:00.000Z');

function context(headers: Record<string, string> = {}) {
  const request: { headers: Record<string, string>; atlasRunnerId?: string } = {
    headers,
  };
  const value = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context: value, request };
}

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

describe('Supervisor runner guards', () => {
  it('uses the runner token only for bootstrap and accepts no caller identity', () => {
    const guard = new SupervisorRunnerBootstrapGuard(
      config({ ATLAS_SUPERVISOR_RUNNER_TOKEN: 'bootstrap-secret' }),
    );
    expect(
      guard.canActivate(
        context({
          'x-atlas-supervisor-runner-token': 'bootstrap-secret',
          'x-atlas-runner-id': 'engineering-runner:caller-supplied',
        }).context,
      ),
    ).toBe(true);
  });

  it('fails closed when bootstrap credential is absent or wrong', () => {
    const guard = new SupervisorRunnerBootstrapGuard(
      config({ ATLAS_SUPERVISOR_RUNNER_TOKEN: 'bootstrap-secret' }),
    );
    expect(() => guard.canActivate(context().context)).toThrow(
      new UnauthorizedException('runner_bootstrap_credential_required'),
    );
    expect(() =>
      guard.canActivate(
        context({ 'x-atlas-supervisor-runner-token': 'wrong' }).context,
      ),
    ).toThrow(new UnauthorizedException('runner_bootstrap_credential_invalid'));
  });

  it('derives runner identity from the API-signed session and ignores a caller runner id', () => {
    const service = new SupervisorRunnerSessionService(
      config({ ATLAS_SUPERVISOR_RUNNER_SESSION_SIGNING_KEY: 'session-key' }),
    );
    const issued = service.issue(NOW);
    const guard = new SupervisorRunnerSessionGuard(service);
    const { context: requestContext, request } = context({
      authorization: `Bearer ${issued.token}`,
      'x-atlas-runner-id': 'engineering-runner:caller-supplied',
    });

    expect(guard.canActivate(requestContext)).toBe(true);
    expect(request.atlasRunnerId).toBe(issued.runnerId);
    expect(request.atlasRunnerId).not.toBe('engineering-runner:caller-supplied');
  });

  it('rejects missing, expired, and forged sessions', () => {
    const service = new SupervisorRunnerSessionService(
      config({ ATLAS_SUPERVISOR_RUNNER_SESSION_SIGNING_KEY: 'session-key' }),
    );
    const guard = new SupervisorRunnerSessionGuard(service);
    expect(() => guard.canActivate(context().context)).toThrow(
      new UnauthorizedException('runner_session_required'),
    );
    const issued = service.issue(new Date('2020-01-01T00:00:00.000Z'), 1_000);
    expect(() =>
      guard.canActivate(
        context({ authorization: `Bearer ${issued.token}` }).context,
      ),
    ).toThrow(new UnauthorizedException('runner_session_expired'));
    expect(() =>
      guard.canActivate(
        context({ authorization: 'Bearer forged.session' }).context,
      ),
    ).toThrow(new UnauthorizedException('runner_session_invalid'));
  });
});
