'use strict';

const {
  runtimeVerify,
} = require('./check-runner-bootstrap-deployment.cjs');
const {
  checkProductionDeploymentGate,
} = require('../api/scripts/check-production-deployment-gate.cjs');

async function checkRunnerProductionDeployment({
  env = process.env,
  runtimeVerifyImpl = runtimeVerify,
  gateImpl = checkProductionDeploymentGate,
  log = console.log,
} = {}) {
  runtimeVerifyImpl({ env });

  const gateEnv = {
    ...env,
    ATLAS_DEPLOYMENT_SERVICE: 'engineering-runner',
  };
  const receipt = await gateImpl({ env: gateEnv });

  log('ATLAS_DEPLOY_GATE_ALLOW', {
    taskId: receipt.taskId,
    executionId: receipt.executionId,
    service: 'engineering-runner',
    commitSha: env.RAILWAY_GIT_COMMIT_SHA,
  });

  return receipt;
}

module.exports = { checkRunnerProductionDeployment };

if (require.main === module) {
  checkRunnerProductionDeployment().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'ATLAS_RUNNER_PRODUCTION_DEPLOY_DENY unknown',
    );
    process.exitCode = 1;
  });
}
