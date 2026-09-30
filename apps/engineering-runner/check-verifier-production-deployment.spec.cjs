'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('verifier production deployment checks bootstrap before service-bound deployment gate', async () => {
  const mod = require('./check-verifier-production-deployment.cjs');
  const calls = [];
  const env = { RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40) };

  const receipt = await mod.checkVerifierProductionDeployment({
    env,
    runtimeVerifyImpl: ({ env: received }) => {
      calls.push(['bootstrap', received]);
      return { commitSha: received.RAILWAY_GIT_COMMIT_SHA };
    },
    gateImpl: async ({ env: received }) => {
      calls.push(['deploy-gate', received]);
      return { taskId: 'task-verifier', executionId: 'exec-verifier' };
    },
    log: () => undefined,
  });

  assert.deepEqual(receipt, {
    taskId: 'task-verifier',
    executionId: 'exec-verifier',
  });
  assert.equal(calls[0][0], 'bootstrap');
  assert.equal(calls[1][0], 'deploy-gate');
  assert.equal(
    calls[1][1].ATLAS_DEPLOYMENT_SERVICE,
    'engineering-verifier',
  );
  assert.equal(env.ATLAS_DEPLOYMENT_SERVICE, undefined);
});

test('verifier production deployment never calls deploy gate when bootstrap fails', async () => {
  const mod = require('./check-verifier-production-deployment.cjs');
  let gateCalls = 0;

  await assert.rejects(
    () => mod.checkVerifierProductionDeployment({
      env: {},
      runtimeVerifyImpl: () => {
        throw new Error('bootstrap_denied');
      },
      gateImpl: async () => {
        gateCalls += 1;
      },
      log: () => undefined,
    }),
    /bootstrap_denied/,
  );

  assert.equal(gateCalls, 0);
});
