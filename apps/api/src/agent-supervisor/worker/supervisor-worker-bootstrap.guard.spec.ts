import type { ExecutionContext } from '@nestjs/common';

type ConfigValues = Record<string, string | undefined>;

function loadBootstrapGuard(): any {
  try {
    return require('./supervisor-worker-bootstrap.guard')
      .SupervisorWorkerBootstrapGuard;
  } catch {
    return undefined;
  }
}

function config(values: ConfigValues) {
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing config: ${key}`);
      return value;
    }),
  };
}

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class WorkerBootstrapController {},
  } as unknown as ExecutionContext;
}

function request(authorization?: string): Record<string, unknown> {
  return {
    headers: authorization ? { authorization } : {},
    body: { workerRole: 'supervisor' },
    query: { workerRole: 'unknown-role' },
  };
}

function guard(values: ConfigValues = {}) {
  const Target = loadBootstrapGuard();
  expect(Target).toBeDefined();
  if (!Target) return undefined;
  return new Target(config(values));
}

describe('SupervisorWorkerBootstrapGuard RED contract', () => {
  const validConfig = {
    ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN: 'bootstrap-test-secret',
    ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE: 'backend',
  };

  it('fails closed when the bootstrap bearer is missing', async () => {
    const target = guard(validConfig);
    if (!target) return;

    await expect(target.canActivate(context(request()))).rejects.toThrow(
      'worker_bootstrap_required',
    );
  });

  it('fails closed when the bootstrap bearer is invalid', async () => {
    const target = guard(validConfig);
    if (!target) return;

    await expect(
      target.canActivate(context(request('Bearer wrong-bootstrap-secret'))),
    ).rejects.toThrow('worker_bootstrap_invalid');
  });

  it('never accepts the Human Owner bearer as a worker bootstrap bearer', async () => {
    const target = guard({
      ...validConfig,
      ATLAS_SUPERVISOR_OWNER_TOKEN: 'owner-secret',
    });
    if (!target) return;

    await expect(
      target.canActivate(context(request('Bearer owner-secret'))),
    ).rejects.toThrow('worker_bootstrap_invalid');
  });

  it('injects the server-fixed role and ignores caller role inputs', async () => {
    const value = request('Bearer bootstrap-test-secret');
    const target = guard(validConfig);
    if (!target) return;

    await expect(target.canActivate(context(value))).resolves.toBe(true);
    expect(value.supervisorWorkerBootstrapRole).toBe('backend');
    expect(value.supervisorWorkerBootstrapRole).not.toBe(value.body);
  });

  it('fails closed for missing or invalid bootstrap configuration', async () => {
    const cases: ConfigValues[] = [
      {},
      { ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE: 'backend' },
      {
        ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN: 'bootstrap-test-secret',
      },
      {
        ...validConfig,
        ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE: 'supervisor',
      },
      {
        ...validConfig,
        ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_ROLE: 'unknown-role',
      },
    ];

    const Target = loadBootstrapGuard();
    expect(Target).toBeDefined();
    if (!Target) return;

    for (const values of cases) {
      const value = request('Bearer bootstrap-test-secret');
      await expect(
        new Target(config(values)).canActivate(context(value)),
      ).rejects.toThrow();
    }
  });
});
