import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorRunnerSessionService } from './supervisor-runner-session.service';

const NOW = new Date('2026-09-08T00:00:00.000Z');

function config(key: string, value?: string): ConfigService {
  return {
    get: jest.fn((name: string) => (name === key ? value : undefined)),
  } as unknown as ConfigService;
}

describe('SupervisorRunnerSessionService', () => {
  it('issues unique server identities and signed sessions without accepting runnerId input', () => {
    const service = new SupervisorRunnerSessionService(
      config('ATLAS_SUPERVISOR_RUNNER_SESSION_SIGNING_KEY', 'session-key'),
    );
    const first = service.issue(NOW);
    const second = service.issue(NOW);

    expect(first.runnerId).toMatch(/^engineering-runner:[0-9a-f-]{36}$/u);
    expect(second.runnerId).not.toBe(first.runnerId);
    expect(service.verify(first.token, NOW)).toMatchObject({
      runnerId: first.runnerId,
      expiresAt: first.expiresAt,
    });
    expect(first.token).not.toContain('session-key');
  });

  it('fails closed when API-only signing material is unavailable', () => {
    const service = new SupervisorRunnerSessionService(
      config('ATLAS_SUPERVISOR_RUNNER_SESSION_SIGNING_KEY'),
    );
    expect(() => service.issue(NOW)).toThrow(
      new ServiceUnavailableException(
        'runner_session_signing_material_unavailable',
      ),
    );
  });
});
