import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SERVICES,
  claimDispatch,
  execute,
  fetchProductionSha,
} from './atlas-production-deploy-executor.mjs';

const SHA = '9'.repeat(40);
const ENV = {
  GITHUB_REPOSITORY: 'h7ysqm48cq-beep/atlas-marketing-os',
  GITHUB_TOKEN: 'github-token',
  GITHUB_RUN_ID: '12345',
  GITHUB_RUN_ATTEMPT: '1',
  ATLAS_SUPERVISOR_API_URL: 'https://atlas.example.test/api/atlas',
  ATLAS_SUPERVISOR_CI_TOKEN: 'ci-token',
  ATLAS_RAILWAY_PRODUCTION_PROJECT_TOKEN: 'railway-project-token',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function quietLogger() {
  return { log() {}, error() {} };
}

test('executor allowlist includes only the bounded deployment services including itself', () => {
  assert.deepEqual(
    SERVICES.map((service) => service.name),
    [
      'engineering-runner',
      'engineering-verifier',
      'browser-worker',
      'api',
      'web',
      'production-deploy-executor',
    ],
  );
  assert.equal(
    SERVICES.find((service) => service.name === 'api')?.id,
    'c23120f6-5d60-44d6-8021-9d6c52387718',
  );
  assert.equal(
    SERVICES.find((service) => service.name === 'web')?.id,
    '0c3af5de-9f7a-419f-804a-89362d2e1da4',
  );
  assert.equal(
    SERVICES.find((service) => service.name === 'production-deploy-executor')?.id,
    '689174b6-63b6-475c-b1c2-c05edb8babf5',
  );
});

test('fetchProductionSha reads the public production ref through Git smart HTTP without GITHUB_TOKEN', async () => {
  let seenHeaders = null;
  const sha = await fetchProductionSha(
    { GITHUB_REPOSITORY: ENV.GITHUB_REPOSITORY },
    async (url, options = {}) => {
      assert.equal(
        String(url),
        'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git/info/refs?service=git-upload-pack',
      );
      seenHeaders = options.headers;
      return new Response(
        `001e# service=git-upload-pack\n00000049${SHA} refs/heads/production/atlas\n`,
        {
          status: 200,
          headers: {
            'content-type': 'application/x-git-upload-pack-advertisement',
          },
        },
      );
    },
  );

  assert.equal(sha, SHA);
  assert.equal(
    seenHeaders.accept,
    'application/x-git-upload-pack-advertisement',
  );
  assert.equal(seenHeaders['user-agent'], 'atlas-production-deploy-executor');
});

test('fetchProductionSha uses Bearer auth when GITHUB_TOKEN is present', async () => {
  let seenHeaders = null;
  const sha = await fetchProductionSha(ENV, async (_url, options = {}) => {
    seenHeaders = options.headers;
    return json({ object: { sha: SHA } });
  });

  assert.equal(sha, SHA);
  assert.equal(seenHeaders.authorization, 'Bearer github-token');
});

test('fetchProductionSha rejects any repository other than the frozen ATLAS repository', async () => {
  let called = false;
  await assert.rejects(
    () =>
      fetchProductionSha(
        {
          GITHUB_REPOSITORY: 'other-owner/other-repo',
          GITHUB_TOKEN: 'github-token',
        },
        async () => {
          called = true;
          return json({ object: { sha: SHA } });
        },
      ),
    /unexpected GitHub repository/,
  );
  assert.equal(called, false);
});

test('claimDispatch uses the stable ATLAS executor dispatcher identity without GitHub run ids', async () => {
  const env = {
    GITHUB_REPOSITORY: ENV.GITHUB_REPOSITORY,
    ATLAS_SUPERVISOR_API_URL: ENV.ATLAS_SUPERVISOR_API_URL,
    ATLAS_SUPERVISOR_CI_TOKEN: ENV.ATLAS_SUPERVISOR_CI_TOKEN,
  };

  for (const service of SERVICES) {
    let payload = null;
    const result = await claimDispatch(env, service, SHA, async (_url, options) => {
      payload = JSON.parse(options.body);
      return json({
        claimed: false,
        reason: 'not_found',
        service: service.name,
        commitSha: SHA,
      });
    });

    assert.equal(result.claimed, false);
    assert.equal(
      payload.dispatcherId,
      'atlas-production-deploy-executor:' + service.name,
    );
  }
});

test('executor claims one authorized worker and deploys the exact production SHA', async () => {
  const seen = {
    deployVariables: null,
    claims: [],
  };

  const fetchImpl = async (url, options = {}) => {
    const href = String(url);

    if (href.includes('/git/ref/heads/production/atlas')) {
      return json({ object: { sha: SHA } });
    }

    if (href.endsWith('/production-deployment/dispatch/claim')) {
      const payload = JSON.parse(options.body);
      seen.claims.push(payload);
      if (payload.service === 'engineering-runner') {
        return json({
          claimed: true,
          reason: null,
          service: 'engineering-runner',
          commitSha: SHA,
          taskId: 'ATLAS-SYS-task',
          executionId: 'ATLAS-EXEC-task',
          reservationId: `ATLAS-DISPATCH-${'a'.repeat(64)}`,
        });
      }
      return json({
        claimed: false,
        reason: 'not_found',
        service: payload.service,
        commitSha: SHA,
      });
    }

    if (href === 'https://backboard.railway.com/graphql/v2') {
      const payload = JSON.parse(options.body);
      if (payload.query.includes('projectToken')) {
        return json({
          data: {
            projectToken: {
              projectId: '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc',
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
            },
          },
        });
      }
      if (payload.query.includes('serviceInstanceDeployV2')) {
        seen.deployVariables = payload.variables;
        return json({
          data: { serviceInstanceDeployV2: 'railway-deployment-1' },
        });
      }
      if (payload.query.includes('deployment(id:')) {
        return json({
          data: {
            deployment: {
              id: 'railway-deployment-1',
              status: 'SUCCESS',
              createdAt: '2026-09-29T00:00:00.000Z',
              serviceId: SERVICES[0].id,
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
              meta: { commitHash: SHA },
            },
          },
        });
      }
    }

    throw new Error(`unexpected request: ${href}`);
  };

  const result = await execute(ENV, {
    fetchImpl,
    sleep: async () => {},
    logger: quietLogger(),
    maxAttempts: 2,
    intervalMs: 0,
  });

  assert.equal(result.sha, SHA);
  assert.equal(result.results[0].deployment.status, 'SUCCESS');
  assert.equal(result.results[1].deployment, null);
  assert.deepEqual(seen.deployVariables, {
    serviceId: SERVICES[0].id,
    environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
    commitSha: SHA,
  });
  assert.deepEqual(
    seen.claims.map((claim) => claim.service),
    [
      'engineering-runner',
      'engineering-verifier',
      'browser-worker',
      'api',
      'web',
      'production-deploy-executor',
    ],
  );
  assert.equal(seen.claims[0].github.commitSha, SHA);
});

test('executor rejects a Railway project token scoped outside production before reserving', async () => {
  let claimCalls = 0;

  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://backboard.railway.com/graphql/v2') {
      const payload = JSON.parse(options.body);
      assert.match(payload.query, /projectToken/);
      return json({
        data: {
          projectToken: {
            projectId: 'wrong-project',
            environmentId: 'wrong-environment',
          },
        },
      });
    }
    if (href.endsWith('/production-deployment/dispatch/claim')) {
      claimCalls += 1;
    }
    throw new Error(`unexpected request: ${href}`);
  };

  await assert.rejects(
    () =>
      execute(ENV, {
        fetchImpl,
        logger: quietLogger(),
      }),
    /Railway project token scope mismatch/,
  );
  assert.equal(claimCalls, 0);
});

test('already-reserved workers never trigger another Railway deploy', async () => {
  let deployMutations = 0;

  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://backboard.railway.com/graphql/v2') {
      const payload = JSON.parse(options.body);
      if (payload.query.includes('projectToken')) {
        return json({
          data: {
            projectToken: {
              projectId: '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc',
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
            },
          },
        });
      }
      if (payload.query.includes('serviceInstanceDeployV2')) {
        deployMutations += 1;
      }
    }
    if (href.includes('/git/ref/heads/production/atlas')) {
      return json({ object: { sha: SHA } });
    }
    if (href.endsWith('/production-deployment/dispatch/claim')) {
      const payload = JSON.parse(options.body);
      return json({
        claimed: false,
        reason: 'already_reserved',
        service: payload.service,
        commitSha: SHA,
        taskId: 'ATLAS-SYS-existing',
        executionId: 'ATLAS-EXEC-existing',
      });
    }
    throw new Error(`unexpected request: ${href}`);
  };

  const result = await execute(ENV, {
    fetchImpl,
    logger: quietLogger(),
  });

  assert.equal(deployMutations, 0);
  assert.equal(result.results.length, 6);
  assert.ok(result.results.every((entry) => entry.deployment === null));
});

test('executor fails closed when Railway returns a failed deployment', async () => {
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/git/ref/heads/production/atlas')) {
      return json({ object: { sha: SHA } });
    }
    if (href.endsWith('/production-deployment/dispatch/claim')) {
      const payload = JSON.parse(options.body);
      if (payload.service === 'engineering-runner') {
        return json({
          claimed: true,
          reason: null,
          service: payload.service,
          commitSha: SHA,
          taskId: 'ATLAS-SYS-task',
          executionId: 'ATLAS-EXEC-task',
          reservationId: `ATLAS-DISPATCH-${'b'.repeat(64)}`,
        });
      }
      return json({
        claimed: false,
        reason: 'not_found',
        service: payload.service,
        commitSha: SHA,
      });
    }
    if (href === 'https://backboard.railway.com/graphql/v2') {
      const payload = JSON.parse(options.body);
      if (payload.query.includes('projectToken')) {
        return json({
          data: {
            projectToken: {
              projectId: '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc',
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
            },
          },
        });
      }
      if (payload.query.includes('serviceInstanceDeployV2')) {
        return json({ data: { serviceInstanceDeployV2: 'dep-failed' } });
      }
      if (payload.query.includes('deployment(id:')) {
        return json({
          data: {
            deployment: {
              id: 'dep-failed',
              status: 'FAILED',
              createdAt: '2026-09-29T00:00:00.000Z',
              serviceId: SERVICES[0].id,
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
              meta: { commitHash: SHA },
            },
          },
        });
      }
    }
    throw new Error(`unexpected request: ${href}`);
  };

  await assert.rejects(
    () =>
      execute(ENV, {
        fetchImpl,
        sleep: async () => {},
        logger: quietLogger(),
        maxAttempts: 1,
        intervalMs: 0,
      }),
    /terminal status FAILED/,
  );
});

test('executor rejects successful deployment evidence for the wrong commit', async () => {
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/git/ref/heads/production/atlas')) {
      return json({ object: { sha: SHA } });
    }
    if (href.endsWith('/production-deployment/dispatch/claim')) {
      const payload = JSON.parse(options.body);
      if (payload.service === 'engineering-runner') {
        return json({
          claimed: true,
          reason: null,
          service: payload.service,
          commitSha: SHA,
          taskId: 'ATLAS-SYS-task',
          executionId: 'ATLAS-EXEC-task',
          reservationId: `ATLAS-DISPATCH-${'c'.repeat(64)}`,
        });
      }
      return json({
        claimed: false,
        reason: 'not_found',
        service: payload.service,
        commitSha: SHA,
      });
    }
    if (href === 'https://backboard.railway.com/graphql/v2') {
      const payload = JSON.parse(options.body);
      if (payload.query.includes('projectToken')) {
        return json({
          data: {
            projectToken: {
              projectId: '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc',
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
            },
          },
        });
      }
      if (payload.query.includes('serviceInstanceDeployV2')) {
        return json({ data: { serviceInstanceDeployV2: 'dep-wrong-sha' } });
      }
      if (payload.query.includes('deployment(id:')) {
        return json({
          data: {
            deployment: {
              id: 'dep-wrong-sha',
              status: 'SUCCESS',
              createdAt: '2026-09-29T00:00:00.000Z',
              serviceId: SERVICES[0].id,
              environmentId: '62379618-8890-40fb-bff8-2db75c57027c',
              meta: { commitHash: '8'.repeat(40) },
            },
          },
        });
      }
    }
    throw new Error(`unexpected request: ${href}`);
  };

  await assert.rejects(
    () =>
      execute(ENV, {
        fetchImpl,
        sleep: async () => {},
        logger: quietLogger(),
        maxAttempts: 1,
        intervalMs: 0,
      }),
    /deployment SHA mismatch/,
  );
});

test('dispatch claim rejects any service outside the frozen production executor allowlist', async () => {
  await assert.rejects(
    () =>
      claimDispatch(
        ENV,
        { name: 'api', id: 'not-allowed' },
        SHA,
        async () => {
          throw new Error('network must not be reached');
        },
      ),
    /unsupported executor service/,
  );
});
