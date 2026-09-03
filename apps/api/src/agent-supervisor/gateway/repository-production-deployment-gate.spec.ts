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

describe('repository-owned production deployment gate', () => {
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
    const fetchImpl = jest.fn().mockResolvedValue(
      response(400, { code: 'production_deployment_resolution_not_found' }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    ).rejects.toThrow(/production_deployment_resolution_not_found/);
  });

  it('fails closed when the resolver response is malformed JSON', async () => {
    const gate = loadGate();
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response(200, 'not-json')) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({ env: validEnv(), fetchImpl }),
    ).rejects.toThrow(/invalid_response/);
  });

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
