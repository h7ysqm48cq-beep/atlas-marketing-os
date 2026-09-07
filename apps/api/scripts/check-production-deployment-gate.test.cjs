'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  checkProductionDeploymentGate,
} = require('./check-production-deployment-gate.cjs');

function deploymentEnv(overrides = {}) {
  return {
    ATLAS_SUPERVISOR_API_URL: 'https://atlas-api.example',
    ATLAS_SUPERVISOR_DEPLOY_RESOLVER_TOKEN: 'resolver-token',
    ATLAS_DEPLOYMENT_SERVICE: 'engineering-runner',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
    ...overrides,
  };
}

test('engineering-runner resolve uses only the deployment resolver credential', async () => {
  let request;
  const receipt = await checkProductionDeploymentGate({
    env: deploymentEnv(),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            allowed: true,
            taskId: 'ATLAS-TASK-9',
            executionId: 'ATLAS-EXEC-TASK-9',
          }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'ATLAS-TASK-9',
    executionId: 'ATLAS-EXEC-TASK-9',
  });
  assert.equal(
    request.url,
    'https://atlas-api.example/engineering/supervisor/gateway/production-deployment/resolve',
  );
  assert.equal(request.init.method, 'POST');
  assert.equal(
    request.init.headers['x-atlas-supervisor-deploy-resolver-token'],
    'resolver-token',
  );
  assert.equal(
    Object.hasOwn(request.init.headers, 'x-atlas-supervisor-ci-token'),
    false,
  );
  assert.equal(JSON.parse(request.init.body).service, 'engineering-runner');
});

test('unknown deployment service is rejected before resolver fetch', async () => {
  let called = false;

  await assert.rejects(
    checkProductionDeploymentGate({
      env: deploymentEnv({ ATLAS_DEPLOYMENT_SERVICE: 'unknown-service' }),
      fetchImpl: async () => {
        called = true;
        throw new Error('unexpected fetch');
      },
    }),
    /ATLAS_DEPLOY_GATE_DENY unsupported ATLAS_DEPLOYMENT_SERVICE/,
  );
  assert.equal(called, false);
});
