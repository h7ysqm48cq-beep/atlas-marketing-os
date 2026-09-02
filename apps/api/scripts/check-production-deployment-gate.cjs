'use strict';

const REQUIRED_ENV = [
  'ATLAS_SUPERVISOR_API_URL',
  'ATLAS_SUPERVISOR_CI_TOKEN',
  'RAILWAY_GIT_REPO_OWNER',
  'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_BRANCH',
  'RAILWAY_GIT_COMMIT_SHA',
];
const SUPPORTED_DEPLOYMENT_SERVICES = new Set([
  'api',
  'web',
  'browser-worker',
]);

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`ATLAS_DEPLOY_GATE_DENY missing ${key}`);
  }
  return value.trim();
}

function deploymentService(env) {
  const configured = env.ATLAS_DEPLOYMENT_SERVICE;
  if (configured === undefined) return 'api';
  if (typeof configured !== 'string' || !configured.trim()) {
    throw new Error(
      'ATLAS_DEPLOY_GATE_DENY unsupported ATLAS_DEPLOYMENT_SERVICE',
    );
  }
  const service = configured.trim();
  if (!SUPPORTED_DEPLOYMENT_SERVICES.has(service)) {
    throw new Error(
      'ATLAS_DEPLOY_GATE_DENY unsupported ATLAS_DEPLOYMENT_SERVICE',
    );
  }
  return service;
}

function failureReason(responseBody, status) {
  if (responseBody && typeof responseBody === 'object') {
    if (typeof responseBody.code === 'string' && responseBody.code) {
      return responseBody.code;
    }
    if (typeof responseBody.reason === 'string' && responseBody.reason) {
      return responseBody.reason;
    }
  }
  return `http_${status}`;
}

async function checkProductionDeploymentGate({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  for (const key of REQUIRED_ENV) requireEnv(env, key);
  if (typeof fetchImpl !== 'function') {
    throw new Error('ATLAS_DEPLOY_GATE_DENY fetch_unavailable');
  }

  const apiUrl = requireEnv(env, 'ATLAS_SUPERVISOR_API_URL').replace(/\/+$/g, '');
  const ciToken = requireEnv(env, 'ATLAS_SUPERVISOR_CI_TOKEN');
  const service = deploymentService(env);
  const payload = {
    service,
    github: {
      repositoryOwner: requireEnv(env, 'RAILWAY_GIT_REPO_OWNER'),
      repositoryName: requireEnv(env, 'RAILWAY_GIT_REPO_NAME'),
      branch: requireEnv(env, 'RAILWAY_GIT_BRANCH'),
      commitSha: requireEnv(env, 'RAILWAY_GIT_COMMIT_SHA'),
    },
  };

  let response;
  try {
    response = await fetchImpl(
      `${apiUrl}/engineering/supervisor/gateway/production-deployment/resolve`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-atlas-supervisor-ci-token': ciToken,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new Error(
      `ATLAS_DEPLOY_GATE_DENY resolver_unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('ATLAS_DEPLOY_GATE_DENY invalid_response');
  }

  if (!response.ok) {
    throw new Error(
      `ATLAS_DEPLOY_GATE_DENY ${failureReason(data, response.status)}`,
    );
  }
  if (!data || data.allowed !== true) {
    throw new Error(
      `ATLAS_DEPLOY_GATE_DENY ${failureReason(data, response.status)}`,
    );
  }
  if (
    typeof data.taskId !== 'string' ||
    !data.taskId.trim() ||
    typeof data.executionId !== 'string' ||
    !data.executionId.trim()
  ) {
    throw new Error('ATLAS_DEPLOY_GATE_DENY invalid_response');
  }

  return {
    taskId: data.taskId,
    executionId: data.executionId,
  };
}

module.exports = { checkProductionDeploymentGate };

if (require.main === module) {
  checkProductionDeploymentGate()
    .then((receipt) => {
      console.log('ATLAS_DEPLOY_GATE_ALLOW', {
        taskId: receipt.taskId,
        executionId: receipt.executionId,
        service: deploymentService(process.env),
        commitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
      });
    })
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : 'ATLAS_DEPLOY_GATE_DENY unknown_error',
      );
      process.exitCode = 1;
    });
}
