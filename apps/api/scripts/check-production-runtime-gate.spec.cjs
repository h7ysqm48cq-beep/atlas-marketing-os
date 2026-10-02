'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkProductionRuntimeGate,
} = require('./check-production-runtime-gate.cjs');

test('runtime gate skips only when no Railway runtime indicators exist', async () => {
  const checkImpl = async () => {
    throw new Error('should not run');
  };

  const result = await checkProductionRuntimeGate({
    env: {},
    checkImpl,
  });

  assert.deepEqual(result, { skipped: true });
});

test('runtime gate fails closed when Railway is detected without deployment id', async () => {
  await assert.rejects(
    checkProductionRuntimeGate({
      env: {
        RAILWAY_ENVIRONMENT_ID: 'env-1',
      },
      checkImpl: async () => ({
        taskId: 'task',
        executionId: 'exec',
      }),
    }),
    /ATLAS_RUNTIME_START_GATE_DENY missing RAILWAY_DEPLOYMENT_ID/,
  );
});

test('runtime gate revalidates the exact Railway deployment receipt before app start', async () => {
  const calls = [];
  const env = {
    RAILWAY_ENVIRONMENT_ID: 'env-1',
    RAILWAY_SERVICE_ID: 'service-1',
    RAILWAY_DEPLOYMENT_ID: '11111111-2222-4333-8444-555555555555',
  };

  const result = await checkProductionRuntimeGate({
    env,
    checkImpl: async (input) => {
      calls.push(input);
      return {
        taskId: 'ATLAS-TASK-1',
        executionId: 'ATLAS-EXEC-1',
      };
    },
  });

  assert.deepEqual(result, {
    skipped: false,
    taskId: 'ATLAS-TASK-1',
    executionId: 'ATLAS-EXEC-1',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env, env);
  assert.equal(calls[0].phase, 'runtime_start');
});
