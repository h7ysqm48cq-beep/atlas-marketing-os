'use strict';

// Temporary source-controlled bootstrap route. The release SHA is deliberately
// NOT hardcoded: a GitHub merge commit differs from the reviewed PR head.
// The Owner must explicitly set ATLAS_BOOTSTRAP_RELEASE_SHA to the *observed*
// merge commit for each service after merge, then remove it after the attempt.
// Never treat this exception as an ordinary signed Supervisor deployment.
const { spawnSync } = require('node:child_process');
const { checkProductionDeploymentGate } =
  require('./check-production-deployment-gate.cjs');

const PROJECT = '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc';
const ENVIRONMENT = '62379618-8890-40fb-bff8-2db75c57027c';
const SERVICES = Object.freeze({
  api: 'c23120f6-5d60-44d6-8021-9d6c52387718',
  'engineering-runner': 'a8413c73-cc42-483a-9932-c5b644665cf4',
});
const COMMIT = /^[0-9a-f]{40}$/;

function deploymentService(env) {
  const service = env.ATLAS_DEPLOYMENT_SERVICE ?? 'api';
  if (!Object.hasOwn(SERVICES, service)) {
    throw new Error('ATLAS_BOOTSTRAP_DENY unsupported_service');
  }
  return service;
}

function exactBootstrapAuthorization(env) {
  const allowedSha = env.ATLAS_BOOTSTRAP_RELEASE_SHA;
  if (allowedSha === undefined) return null;
  if (typeof allowedSha !== 'string' || !COMMIT.test(allowedSha)) {
    throw new Error('ATLAS_BOOTSTRAP_DENY invalid_allowed_sha');
  }
  const service = deploymentService(env);
  const required = {
    RAILWAY_PROJECT_ID: PROJECT,
    RAILWAY_ENVIRONMENT_ID: ENVIRONMENT,
    RAILWAY_SERVICE_ID: SERVICES[service],
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: allowedSha,
  };
  for (const [key, expected] of Object.entries(required)) {
    if (env[key] !== expected) {
      throw new Error('ATLAS_BOOTSTRAP_DENY ' + key);
    }
  }
  return { service, commitSha: allowedSha };
}

function runMigration(env) {
  const result = spawnSync('npm', ['run', 'db:migrate', '--workspace', 'apps/api'], {
    env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('ATLAS_DEPLOY_MIGRATION_FAILED');
  }
}

async function runPreDeploy({
  env = process.env,
  checkGate = checkProductionDeploymentGate,
  migrate = runMigration,
} = {}) {
  const bootstrap = exactBootstrapAuthorization(env);
  if (bootstrap) {
    console.log('ATLAS_BOOTSTRAP_EXACT_EXCEPTION', bootstrap);
    return { mode: 'BOOTSTRAP_EXCEPTION', ...bootstrap };
  }

  const service = deploymentService(env);
  const receipt = await checkGate({ env });
  if (service === 'api') migrate(env);
  return { mode: 'NORMAL_SUPERVISOR_GATE', service, receipt };
}

module.exports = {
  runPreDeploy,
  exactBootstrapAuthorization,
};

if (require.main === module) {
  runPreDeploy().catch((err) => {
    console.error(err instanceof Error ? err.message : 'ATLAS_BOOTSTRAP_DENY unknown');
    process.exitCode = 1;
  });
}
