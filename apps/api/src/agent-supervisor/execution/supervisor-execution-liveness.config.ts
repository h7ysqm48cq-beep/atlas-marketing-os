export interface SupervisorExecutionLivenessConfig {
  queuedClaimTimeoutMs: number;
  heartbeatIntervalMs: number;
  runningLeaseMs: number;
  reconciliationIntervalMs: number;
}

export type SupervisorExecutionLivenessOverrides = Partial<
  SupervisorExecutionLivenessConfig
>;

const DEFAULT_LIVENESS_CONFIG: SupervisorExecutionLivenessConfig = {
  queuedClaimTimeoutMs: 120_000,
  heartbeatIntervalMs: 20_000,
  runningLeaseMs: 60_000,
  reconciliationIntervalMs: 30_000,
};

function assertFinitePositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive integer`);
  }
}

function assertRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  assertFinitePositiveInteger(name, value);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} is outside the supported range`);
  }
}

export function resolveSupervisorExecutionLivenessConfig(
  overrides: SupervisorExecutionLivenessOverrides = {},
): SupervisorExecutionLivenessConfig {
  const config = { ...DEFAULT_LIVENESS_CONFIG, ...overrides };

  assertRange('queuedClaimTimeoutMs', config.queuedClaimTimeoutMs, 10_000, 900_000);
  assertRange('heartbeatIntervalMs', config.heartbeatIntervalMs, 5_000, 60_000);
  if (overrides.runningLeaseMs !== undefined) {
    assertRange(
      'runningLeaseMs',
      config.runningLeaseMs,
      3 * config.heartbeatIntervalMs,
      900_000,
    );
  }
  assertRange(
    'reconciliationIntervalMs',
    config.reconciliationIntervalMs,
    5_000,
    300_000,
  );

  return config;
}
