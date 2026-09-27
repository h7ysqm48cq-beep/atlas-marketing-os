'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkProductionDeploymentGate,
} = require('./check-production-deployment-gate.cjs');

test('shared deployment gate accepts engineering-verifier and forwards exact provenance', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'engineering-verifier',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
  };
  let request;

  const receipt = await checkProductionDeploymentGate({
    env,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-verifier',
          executionId: 'exec-verifier',
        }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'task-verifier',
    executionId: 'exec-verifier',
  });
  assert.equal(
    JSON.parse(request.init.body).service,
    'engineering-verifier',
  );
});
