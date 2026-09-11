import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type GateResult = {
  taskId: string;
  executionId: string;
};

type GateModule = {
  checkProductionDeploymentGate?: (options: {
    env: NodeJS.ProcessEnv;
    fetchImpl: typeof fetch;
  }) => Promise<GateResult>;
};

const SCRIPT_PATH = resolve(
  process.cwd(),
  'scripts/check-production-deployment-gate.cjs',
);
const RAILWAY_CONFIG_PATH = resolve(process.cwd(), '../../railway.json');
const BROWSER_WORKER_RAILWAY_CONFIG_PATH = resolve(
  process.cwd(),
  '../browser-worker/railway.json',
);

function loadGate(): Required<GateModule> {
  let loaded: GateModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require(SCRIPT_PATH) as GateModule;
  } catch (error) {
    throw new Error(
      `repository-owned production deployment gate script is missing: ${String(error)}`,
    );
  }
  if (typeof loaded.checkProductionDeploymentGate !== 'function') {
    throw new Error('repository-owned production deployment gate export is missing');
  }
  return loaded as Required<GateModule>;
}

function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ATLAS_SUPERVISOR_API_URL: 'https://supervisor.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'ci-secret-value',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
    ...overrides,
  };
}

function response(status: number, body: unknown): Response {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

async function rejectedGate(promise: Promise<GateResult>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('expected production deployment gate rejection');
}

describe('repository-owned production deployment gate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails closed when required Railway Git provenance is missing', async () => {
    const gate = loadGate();
    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv({ RAILWAY_GIT_COMMIT_SHA: '' }),
        fetchImpl: jest.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/RAILWAY_GIT_COMMIT_SHA/);
  });

  it('fails closed when the resolver returns HTTP 400', async () => {
    const gate = loadGate();
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        response(400, { code: 'production_deployment_resolution_not_found' }),
      ) as unknown as typeof fetch;

    const error = await rejectedGate(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/elapsed=\d+ms/);
    expect(error.message).toContain('status=400');
    expect(error.message).toContain(
      'failure=production_deployment_resolution_not_found',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the resolver response is malformed JSON', async () => {
    const gate = loadGate();
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response(200, 'not-json')) as unknown as typeof fetch;

    const error = await rejectedGate(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/elapsed=\d+ms/);
    expect(error.message).toContain('status=200');
    expect(error.message).toContain('failure=invalid_response');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses a 30 second resolver timeout and fails closed without retry or secret leakage', async () => {
    const gate = loadGate();
    const env = validEnv({
      ATLAS_SUPERVISOR_API_URL: 'https://private-supervisor.example.test',
      ATLAS_SUPERVISOR_CI_TOKEN: 'private-ci-token',
    });
    const timeoutError = Object.assign(
      new Error(
        'request to https://private-supervisor.example.test used private-ci-token',
      ),
      { name: 'TimeoutError' },
    );
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(timeoutError) as unknown as typeof fetch;
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    const error = await rejectedGate(
      gate.checkProductionDeploymentGate({ env, fetchImpl }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/elapsed=\d+ms/);
    expect(error.message).toContain('status=unavailable');
    expect(error.message).toContain('failure=resolver_timeout');
    expect(error.message).not.toContain('private-ci-token');
    expect(error.message).not.toContain(
      'https://private-supervisor.example.test',
    );
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    'fails closed on HTTP %i with safe elapsed/status/failure diagnostics',
    async (status) => {
      const gate = loadGate();
      const env = validEnv({
        ATLAS_SUPERVISOR_API_URL: 'https://private-supervisor.example.test',
        ATLAS_SUPERVISOR_CI_TOKEN: 'private-ci-token',
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        response(status, {
          reason:
            'denied private-ci-token https://private-supervisor.example.test',
        }),
      ) as unknown as typeof fetch;

      const error = await rejectedGate(
        gate.checkProductionDeploymentGate({ env, fetchImpl }),
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/elapsed=\d+ms/);
      expect(error.message).toContain(`status=${status}`);
      expect(error.message).toContain('failure=');
      expect(error.message).not.toContain('private-ci-token');
      expect(error.message).not.toContain(
        'https://private-supervisor.example.test',
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed when allowed is false', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, { allowed: false, reason: 'denied' }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    ).rejects.toThrow(/denied/);
  });

  it('fails closed when an allowed response omits receipt ids', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, { allowed: true, reason: null }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    ).rejects.toThrow(/invalid_response/);
  });

  it('allows only a complete receipt and sends exact api provenance without leaking the token', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, {
        allowed: true,
        reason: null,
        taskId: 'ATLAS-DEPLOY-1',
        executionId: 'ATLAS-DEPLOY-EXEC-1',
      }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    ).resolves.toEqual({
      taskId: 'ATLAS-DEPLOY-1',
      executionId: 'ATLAS-DEPLOY-EXEC-1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://supervisor.example.test/engineering/supervisor/gateway/production-deployment/resolve',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-atlas-supervisor-ci-token': 'ci-secret-value',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      service: 'api',
      github: {
        repositoryOwner: 'h7ysqm48cq-beep',
        repositoryName: 'atlas-marketing-os',
        branch: 'production/atlas',
        commitSha: 'a'.repeat(40),
      },
    });
  });

  it('sends exact browser-worker provenance when the deployment service is explicitly selected', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, {
        allowed: true,
        reason: null,
        taskId: 'ATLAS-DEPLOY-WORKER-1',
        executionId: 'ATLAS-DEPLOY-WORKER-EXEC-1',
      }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv({ ATLAS_DEPLOYMENT_SERVICE: 'browser-worker' }),
        fetchImpl,
      }),
    ).resolves.toEqual({
      taskId: 'ATLAS-DEPLOY-WORKER-1',
      executionId: 'ATLAS-DEPLOY-WORKER-EXEC-1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      service: 'browser-worker',
      github: {
        repositoryOwner: 'h7ysqm48cq-beep',
        repositoryName: 'atlas-marketing-os',
        branch: 'production/atlas',
        commitSha: 'a'.repeat(40),
      },
    });
  });

  it('fails closed before calling the resolver when the deployment service is unsupported', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv({ ATLAS_DEPLOYMENT_SERVICE: 'browser-worker-preview' }),
        fetchImpl,
      }),
    ).rejects.toThrow(/unsupported ATLAS_DEPLOYMENT_SERVICE/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the repository Railway preDeploy gate before database migration', () => {
    const config = JSON.parse(readFileSync(RAILWAY_CONFIG_PATH, 'utf8')) as {
      deploy?: { preDeployCommand?: string[] };
    };
    expect(config.deploy?.preDeployCommand).toEqual([
      'node apps/api/scripts/check-production-deployment-gate.cjs && npm run db:migrate --workspace apps/api',
    ]);
  });

  it('keeps Browser Worker Railway preDeploy service-bound and migration-free', () => {
    const config = JSON.parse(
      readFileSync(BROWSER_WORKER_RAILWAY_CONFIG_PATH, 'utf8'),
    ) as {
      deploy?: { preDeployCommand?: string[] };
    };

    const commands = config.deploy?.preDeployCommand ?? [];

    expect(commands).toEqual([
      'ATLAS_DEPLOYMENT_SERVICE=browser-worker node apps/api/scripts/check-production-deployment-gate.cjs',
    ]);

    expect(commands.join('\n')).not.toMatch(/db:migrate|prisma migrate/i);
  });


});
