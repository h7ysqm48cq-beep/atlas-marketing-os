import { BadRequestException, Injectable } from '@nestjs/common';

export const DEPLOYMENT_AUTOMATION_SERVICE =
  'production-deploy-executor' as const;
export const DEPLOYMENT_AUTOMATION_DEGRADED_AFTER_MS = 3 * 60_000;
export const DEPLOYMENT_AUTOMATION_STALE_AFTER_MS = 5 * 60_000;

export type DeploymentAutomationHeartbeatPhase =
  | 'cycle_start'
  | 'cycle_running'
  | 'cycle_complete'
  | 'cycle_failed';

export interface DeploymentAutomationHeartbeatInput {
  service: string;
  phase: DeploymentAutomationHeartbeatPhase;
  cycle: number;
  commitSha?: string | null;
  claimedWork?: boolean | null;
  nextPollMs?: number | null;
}

export interface DeploymentAutomationHeartbeatSnapshot {
  service: typeof DEPLOYMENT_AUTOMATION_SERVICE;
  phase: DeploymentAutomationHeartbeatPhase;
  cycle: number;
  commitSha: string | null;
  claimedWork: boolean | null;
  nextPollMs: number | null;
  receivedAt: string;
}

const PHASES = new Set<DeploymentAutomationHeartbeatPhase>([
  'cycle_start',
  'cycle_running',
  'cycle_complete',
  'cycle_failed',
]);
const FULL_SHA = /^[0-9a-f]{40}$/i;

@Injectable()
export class DeploymentAutomationTelemetryService {
  private latest: DeploymentAutomationHeartbeatSnapshot | null = null;

  record(
    input: DeploymentAutomationHeartbeatInput,
    now = new Date(),
  ): DeploymentAutomationHeartbeatSnapshot {
    if (input.service !== DEPLOYMENT_AUTOMATION_SERVICE) {
      throw new BadRequestException(
        'deployment_automation_heartbeat_service_invalid',
      );
    }
    if (!PHASES.has(input.phase)) {
      throw new BadRequestException(
        'deployment_automation_heartbeat_phase_invalid',
      );
    }
    if (!Number.isInteger(input.cycle) || input.cycle <= 0) {
      throw new BadRequestException(
        'deployment_automation_heartbeat_cycle_invalid',
      );
    }

    const commitSha = input.commitSha?.trim().toLowerCase() || null;
    if (commitSha !== null && !FULL_SHA.test(commitSha)) {
      throw new BadRequestException(
        'deployment_automation_heartbeat_sha_invalid',
      );
    }

    const nextPollMs =
      input.nextPollMs === undefined || input.nextPollMs === null
        ? null
        : input.nextPollMs;
    if (
      nextPollMs !== null &&
      (!Number.isInteger(nextPollMs) || nextPollMs < 0)
    ) {
      throw new BadRequestException(
        'deployment_automation_heartbeat_next_poll_invalid',
      );
    }

    const snapshot: DeploymentAutomationHeartbeatSnapshot = {
      service: DEPLOYMENT_AUTOMATION_SERVICE,
      phase: input.phase,
      cycle: input.cycle,
      commitSha,
      claimedWork:
        typeof input.claimedWork === 'boolean' ? input.claimedWork : null,
      nextPollMs,
      receivedAt: now.toISOString(),
    };
    this.latest = snapshot;
    return structuredClone(snapshot);
  }

  snapshot(): DeploymentAutomationHeartbeatSnapshot | null {
    return this.latest ? structuredClone(this.latest) : null;
  }
}
