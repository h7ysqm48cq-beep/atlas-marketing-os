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
    sleepImpl?: (ms: number) => Promise<void>;
  }) => Promise<GateResult>;
};

const SCRIPT_PATH = resolve(
  process.cwd(),
  'scripts/check-production-deployment-gate.cjs',
);
const BOOTSTRAP_SCRIPT_PATH = resolve(
  process.cwd(),
  'scripts/check-api-bootstrap-deployment.cjs',
);
const RAILWAY_CONFIG_PATH = resolve(process.cwd(), '../../railway.json');
const BROWSER_WORKER_RAILWAY_CONFIG_PATH = resolve(
  process.cwd(),
  '../browser-worker/railway.json',
);
const ENGINEERING_RUNNER_RAILWAY_CONFIG_PATH = resolve(
  process.cwd(),
  '../engineering-runner/railway.json',
);
const ENGINEERING_RUNNER_DOCKERFILE_PATH = resolve(
  process.cwd(),
  '../engineering-runner/Dockerfile',
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
    RAILWAY_DEPLOYMENT_ID: '12345678-1234-4123-8123-123456789abc',
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

  it('forwards missing Railway branch for reservation-backed Supervisor resolution', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, {
        allowed: true,
        reason: null,
        taskId: 'ATLAS-BRANCHLESS-DEPLOY-1',
        executionId: 'ATLAS-BRANCHLESS-DEPLOY-EXEC-1',
      }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv({ RAILWAY_GIT_BRANCH: '' }),
        fetchImpl,
      }),
    ).resolves.toEqual({
      taskId: 'ATLAS-BRANCHLESS-DEPLOY-1',
      executionId: 'ATLAS-BRANCHLESS-DEPLOY-EXEC-1',
    });

    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body));
    expect(body.provenanceMode).toBe('supervisor_dispatch_reservation');
    expect(body.github).toEqual({
      repositoryOwner: 'h7ysqm48cq-beep',
      repositoryName: 'atlas-marketing-os',
      branch: 'production/atlas',
      commitSha: 'a'.repeat(40),
    });
  });

  it('fails closed when the resolver returns HTTP 400', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockImplementation(async () =>
      response(400, { code: 'production_deployment_resolution_not_found' }),
    ) as unknown as typeof fetch;
    const sleepImpl = jest.fn().mockResolvedValue(undefined);

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv(),
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toThrow(/production_deployment_resolution_not_found/);

    expect(fetchImpl).toHaveBeenCalledTimes(16);
    expect(sleepImpl).toHaveBeenCalledTimes(15);
  });

  it('retries a transient resolver transport failure and accepts the next valid receipt', async () => {
    const gate = loadGate();
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(
        response(200, {
          allowed: true,
          reason: null,
          taskId: 'ATLAS-DEPLOY-RETRY-1',
          executionId: 'ATLAS-DEPLOY-RETRY-EXEC-1',
        }),
      ) as unknown as typeof fetch;
    const sleepImpl = jest.fn().mockResolvedValue(undefined);

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv(),
        fetchImpl,
        sleepImpl,
      }),
    ).resolves.toEqual({
      taskId: 'ATLAS-DEPLOY-RETRY-1',
      executionId: 'ATLAS-DEPLOY-RETRY-EXEC-1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed after exhausting transient resolver transport retries', async () => {
    const gate = loadGate();
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    const sleepImpl = jest.fn().mockResolvedValue(undefined);

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv(),
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toThrow(/resolver_unreachable: timeout/);

    expect(fetchImpl).toHaveBeenCalledTimes(16);
    expect(sleepImpl).toHaveBeenCalledTimes(15);
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
      phase: 'pre_deploy',
      deploymentId: '12345678-1234-4123-8123-123456789abc',
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
      phase: 'pre_deploy',
      deploymentId: '12345678-1234-4123-8123-123456789abc',
      github: {
        repositoryOwner: 'h7ysqm48cq-beep',
        repositoryName: 'atlas-marketing-os',
        branch: 'production/atlas',
        commitSha: 'a'.repeat(40),
      },
    });
  });

  it('sends exact engineering-runner provenance when that production service is selected', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, {
        allowed: true,
        reason: null,
        taskId: 'ATLAS-DEPLOY-RUNNER-1',
        executionId: 'ATLAS-DEPLOY-RUNNER-EXEC-1',
      }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv({ ATLAS_DEPLOYMENT_SERVICE: 'engineering-runner' }),
        fetchImpl,
      }),
    ).resolves.toEqual({
      taskId: 'ATLAS-DEPLOY-RUNNER-1',
      executionId: 'ATLAS-DEPLOY-RUNNER-EXEC-1',
    });

    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      service: 'engineering-runner',
    });
  });

  it('sends exact production-deploy-executor provenance when that production service is selected', async () => {
    const gate = loadGate();
    const fetchImpl = jest.fn().mockResolvedValue(
      response(200, {
        allowed: true,
        reason: null,
        taskId: 'ATLAS-DEPLOY-EXECUTOR-1',
        executionId: 'ATLAS-DEPLOY-EXECUTOR-EXEC-1',
      }),
    ) as unknown as typeof fetch;

    await expect(
      gate.checkProductionDeploymentGate({
        env: validEnv({
          ATLAS_DEPLOYMENT_SERVICE: 'production-deploy-executor',
        }),
        fetchImpl,
      }),
    ).resolves.toEqual({
      taskId: 'ATLAS-DEPLOY-EXECUTOR-1',
      executionId: 'ATLAS-DEPLOY-EXECUTOR-EXEC-1',
    });

    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      service: 'production-deploy-executor',
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

  it('restores the normal repository Railway API production deployment gate without migrations', () => {
    const config = JSON.parse(readFileSync(RAILWAY_CONFIG_PATH, 'utf8')) as {
      deploy?: { preDeployCommand?: string[] };
    };
    const commands = config.deploy?.preDeployCommand ?? [];
    expect(commands).toEqual([
      'node apps/api/scripts/check-production-deployment-gate.cjs',
    ]);
    expect(commands.join('\n')).not.toMatch(/db:migrate|prisma migrate/i);
    expect(commands).toHaveLength(1);
    expect(commands.join('\n')).not.toMatch(/check-api-bootstrap-deployment/i);
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

  it('keeps Engineering Runner bootstrap and production deployment gates ordered and migration-free', () => {
    const config = JSON.parse(
      readFileSync(ENGINEERING_RUNNER_RAILWAY_CONFIG_PATH, 'utf8'),
    ) as {
      deploy?: { preDeployCommand?: string[] };
    };

    const commands = config.deploy?.preDeployCommand ?? [];

    expect(commands).toEqual([
      'node apps/engineering-runner/check-runner-production-deployment.cjs',
    ]);
    expect(commands.join('\n')).not.toMatch(/db:migrate|prisma migrate/i);
  });

  it('packages Engineering Runner as a persistent Git/Python-capable worker without embedding runtime credentials', () => {
    const dockerfile = readFileSync(ENGINEERING_RUNNER_DOCKERFILE_PATH, 'utf8');

    expect(dockerfile).toMatch(/FROM node:22-bookworm/);
    expect(dockerfile).toMatch(/\bgit\b/);
    expect(dockerfile).toMatch(/\bpython3\b/);
    expect(dockerfile).toMatch(
      /npm run build --workspace apps\/engineering-runner/,
    );
    expect(dockerfile).toMatch(
      /CMD \["npm", "run", "start", "--workspace", "apps\/engineering-runner"\]/,
    );
    expect(dockerfile).not.toMatch(
      /ATLAS_SUPERVISOR_|ATLAS_ENGINEERING_RUNNER_(SOURCE|PUBLISHER)_TOKEN|db:migrate|prisma migrate/i,
    );
  });
});

describe('temporary exact-parent API bootstrap recovery', () => {
  const parent = 'aa46291585a73ba5bed86b18b29cd47fb8c2cfd2';
  const sha = 'b'.repeat(40);
  const files = [
    'railway.json',
    'apps/api/scripts/check-api-bootstrap-deployment.cjs',
    'apps/api/src/agent-supervisor/gateway/repository-production-deployment-gate.spec.ts',
  ];
  const env = {
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: sha,
    RAILWAY_SERVICE_ID: 'c23120f6-5d60-44d6-8021-9d6c52387718',
    RAILWAY_ENVIRONMENT_ID: '62379618-8890-40fb-bff8-2db75c57027c',
  };
  const now = Date.parse('2026-09-25T22:30:00Z');
  const bootstrap = require(BOOTSTRAP_SCRIPT_PATH) as {
    main: (env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, now: number) => Promise<void>;
  };

  function githubFetch(options: {
    tip?: string;
    firstParent?: string;
    parents?: number;
    files?: string[];
  } = {}) {
    return jest.fn()
      .mockResolvedValueOnce(response(200, {
        name: 'production/atlas', commit: { sha: options.tip ?? sha },
      }))
      .mockResolvedValueOnce(response(200, {
        sha,
        parents: [
          { sha: options.firstParent ?? parent },
          ...(options.parents === 1 ? [] : [{ sha: 'c'.repeat(40) }]),
        ],
        files: (options.files ?? files).map(filename => ({ filename })),
      })) as unknown as typeof fetch;
  }

  it('logs a scoped exception, never a Supervisor authorization', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    try {
      const fetchImpl = githubFetch();
      await bootstrap.main(env, fetchImpl, now);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith(
        'ATLAS_API_BOOTSTRAP_EXCEPTION_NOT_SUPERVISOR_APPROVAL',
        expect.objectContaining({ commitSha: sha, parent, service: 'api' }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ['wrong service', { RAILWAY_SERVICE_ID: 'other' }],
    ['wrong environment', { RAILWAY_ENVIRONMENT_ID: 'other' }],
    ['wrong repo', { RAILWAY_GIT_REPO_NAME: 'other' }],
    ['wrong branch', { RAILWAY_GIT_BRANCH: 'main' }],
    ['wrong workload', { ATLAS_DEPLOYMENT_SERVICE: 'engineering-runner' }],
  ])('rejects %s before fetching GitHub', async (_name, override) => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(bootstrap.main({ ...env, ...override }, fetchImpl, now))
      .rejects.toThrow(/ATLAS_API_BOOTSTRAP_DENY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects expired recovery before GitHub access', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(bootstrap.main(env, fetchImpl, Date.parse('2026-09-26T12:00:00Z')))
      .rejects.toThrow(/expired/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['changed production tip', { tip: 'd'.repeat(40) }, /production_tip/],
    ['changed parent', { firstParent: 'd'.repeat(40) }, /parent/],
    ['non-merge commit', { parents: 1 }, /parent/],
    ['extra file', { files: [...files, 'apps/api/src/main.ts'] }, /scope/],
    ['missing file', { files: files.slice(1) }, /scope/],
  ])('rejects %s', async (_name, options, error) => {
    await expect(bootstrap.main(env, githubFetch(options), now))
      .rejects.toThrow(error);
  });
});
