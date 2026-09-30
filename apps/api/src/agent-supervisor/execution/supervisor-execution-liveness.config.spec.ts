type LivenessConfig = {
  queuedClaimTimeoutMs: number;
  heartbeatIntervalMs: number;
  runningLeaseMs: number;
  reconciliationIntervalMs: number;
};

type LivenessResolver = (input?: unknown) => LivenessConfig;

function loadResolver(): LivenessResolver | null {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const target = path.join(__dirname, 'supervisor-execution-liveness.config.ts');
    if (!fs.existsSync(target)) return null;
    const loaded = require(target) as {
      resolveSupervisorExecutionLivenessConfig?: unknown;
    };
    return typeof loaded.resolveSupervisorExecutionLivenessConfig === 'function'
      ? (loaded.resolveSupervisorExecutionLivenessConfig as LivenessResolver)
      : null;
  } catch {
    return null;
  }
}

function requireResolver(): LivenessResolver | null {
  const resolver = loadResolver();
  expect(resolver).toEqual(expect.any(Function));
  return resolver;
}

describe('Supervisor execution liveness configuration', () => {
  it('provides the fail-closed default timing policy', () => {
    const resolver = requireResolver();
    if (!resolver) return;

    expect(resolver()).toEqual({
      queuedClaimTimeoutMs: 120_000,
      heartbeatIntervalMs: 20_000,
      runningLeaseMs: 60_000,
      reconciliationIntervalMs: 30_000,
    });
  });

  it('enforces queued-claim timeout bounds without clamping invalid values', () => {
    const resolver = requireResolver();
    if (!resolver) return;

    expect(() => resolver({ queuedClaimTimeoutMs: 9_999 })).toThrow();
    expect(resolver({ queuedClaimTimeoutMs: 10_000 }).queuedClaimTimeoutMs).toBe(
      10_000,
    );
    expect(
      resolver({ queuedClaimTimeoutMs: 900_000 }).queuedClaimTimeoutMs,
    ).toBe(900_000);
    expect(() => resolver({ queuedClaimTimeoutMs: 900_001 })).toThrow();
    expect(() => resolver({ queuedClaimTimeoutMs: Number.NaN })).toThrow();
    expect(() => resolver({ queuedClaimTimeoutMs: 0 })).toThrow();
    expect(() => resolver({ queuedClaimTimeoutMs: 10_000.5 })).toThrow();
  });

  it('enforces heartbeat interval bounds', () => {
    const resolver = requireResolver();
    if (!resolver) return;

    expect(() => resolver({ heartbeatIntervalMs: 4_999 })).toThrow();
    expect(resolver({ heartbeatIntervalMs: 5_000 }).heartbeatIntervalMs).toBe(
      5_000,
    );
    expect(resolver({ heartbeatIntervalMs: 60_000 }).heartbeatIntervalMs).toBe(
      60_000,
    );
    expect(() => resolver({ heartbeatIntervalMs: 60_001 })).toThrow();
  });

  it('requires a running lease at least three heartbeat intervals and at most fifteen minutes', () => {
    const resolver = requireResolver();
    if (!resolver) return;

    expect(() =>
      resolver({ heartbeatIntervalMs: 20_000, runningLeaseMs: 59_999 }),
    ).toThrow();
    expect(
      resolver({ heartbeatIntervalMs: 20_000, runningLeaseMs: 60_000 })
        .runningLeaseMs,
    ).toBe(60_000);
    expect(() =>
      resolver({ heartbeatIntervalMs: 60_000, runningLeaseMs: 179_999 }),
    ).toThrow();
    expect(
      resolver({ heartbeatIntervalMs: 60_000, runningLeaseMs: 180_000 })
        .runningLeaseMs,
    ).toBe(180_000);
    expect(() => resolver({ runningLeaseMs: 900_001 })).toThrow();
  });

  it('enforces reconciliation interval bounds', () => {
    const resolver = requireResolver();
    if (!resolver) return;

    expect(() => resolver({ reconciliationIntervalMs: 4_999 })).toThrow();
    expect(
      resolver({ reconciliationIntervalMs: 5_000 }).reconciliationIntervalMs,
    ).toBe(5_000);
    expect(
      resolver({ reconciliationIntervalMs: 300_000 }).reconciliationIntervalMs,
    ).toBe(300_000);
    expect(() => resolver({ reconciliationIntervalMs: 300_001 })).toThrow();
  });
});
