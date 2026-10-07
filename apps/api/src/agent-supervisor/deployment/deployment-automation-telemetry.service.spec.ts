import { BadRequestException } from '@nestjs/common';
import {
  DEPLOYMENT_AUTOMATION_SERVICE,
  DeploymentAutomationTelemetryService,
} from './deployment-automation-telemetry.service';

describe('DeploymentAutomationTelemetryService', () => {
  it('records a server-timestamped deploy-daemon heartbeat', () => {
    const service = new DeploymentAutomationTelemetryService();
    const now = new Date('2026-10-07T15:30:00.000Z');

    expect(
      service.record(
        {
          service: DEPLOYMENT_AUTOMATION_SERVICE,
          phase: 'cycle_complete',
          cycle: 42,
          commitSha: 'fb5e55481844c4670d451d5a429640e07f5482b5',
          claimedWork: false,
          nextPollMs: 120_000,
        },
        now,
      ),
    ).toEqual({
      service: DEPLOYMENT_AUTOMATION_SERVICE,
      phase: 'cycle_complete',
      cycle: 42,
      commitSha: 'fb5e55481844c4670d451d5a429640e07f5482b5',
      claimedWork: false,
      nextPollMs: 120_000,
      receivedAt: '2026-10-07T15:30:00.000Z',
    });
  });

  it.each([
    [
      {
        service: 'api',
        phase: 'cycle_complete',
        cycle: 1,
      },
      'deployment_automation_heartbeat_service_invalid',
    ],
    [
      {
        service: DEPLOYMENT_AUTOMATION_SERVICE,
        phase: 'invalid',
        cycle: 1,
      },
      'deployment_automation_heartbeat_phase_invalid',
    ],
    [
      {
        service: DEPLOYMENT_AUTOMATION_SERVICE,
        phase: 'cycle_complete',
        cycle: 0,
      },
      'deployment_automation_heartbeat_cycle_invalid',
    ],
    [
      {
        service: DEPLOYMENT_AUTOMATION_SERVICE,
        phase: 'cycle_complete',
        cycle: 1,
        commitSha: 'bad-sha',
      },
      'deployment_automation_heartbeat_sha_invalid',
    ],
  ])('rejects invalid heartbeat identity %#', (input, message) => {
    const service = new DeploymentAutomationTelemetryService();

    expect(() => service.record(input as never)).toThrow(
      new BadRequestException(message),
    );
  });
});
