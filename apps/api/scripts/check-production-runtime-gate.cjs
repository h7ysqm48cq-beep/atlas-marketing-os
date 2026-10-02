'use strict';

const {
  checkProductionDeploymentGate,
} = require('./check-production-deployment-gate.cjs');

const RAILWAY_RUNTIME_INDICATORS = [
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_GIT_COMMIT_SHA',
  'RAILWAY_GIT_REPO_OWNER',
  'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_DEPLOYMENT_ID',
];

function hasValue(env, key) {
  return typeof env[key] === 'string' && Boolean(env[key].trim());
}

async function checkProductionRuntimeGate({
  env = process.env,
  checkImpl = checkProductionDeploymentGate,
} = {}) {
  const railwaySignals = RAILWAY_RUNTIME_INDICATORS.filter((key) =>
    hasValue(env, key),
  );

  if (railwaySignals.length === 0) {
    return { skipped: true };
  }

  if (!hasValue(env, 'RAILWAY_DEPLOYMENT_ID')) {
    throw new Error(
      'ATLAS_RUNTIME_START_GATE_DENY missing RAILWAY_DEPLOYMENT_ID',
    );
  }

  const receipt = await checkImpl({
    env,
    phase: 'runtime_start',
  });

  return {
    skipped: false,
    taskId: receipt.taskId,
    executionId: receipt.executionId,
  };
}

module.exports = { checkProductionRuntimeGate };

if (require.main === module) {
  checkProductionRuntimeGate()
    .then((result) => {
      if (result.skipped) {
        console.log('ATLAS_RUNTIME_START_GATE_SKIP_NON_RAILWAY');
        return;
      }

      console.log('ATLAS_RUNTIME_START_GATE_ALLOW', {
        taskId: result.taskId,
        executionId: result.executionId,
        deploymentId: process.env.RAILWAY_DEPLOYMENT_ID,
        commitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
      });
    })
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : 'ATLAS_RUNTIME_START_GATE_DENY unknown_error',
      );
      process.exit(1);
    });
}
