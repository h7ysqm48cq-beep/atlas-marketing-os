import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_REPOSITORY = 'h7ysqm48cq-beep/atlas-marketing-os';
const PRODUCTION_BRANCH = 'production/atlas';
const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';
const RAILWAY_PROJECT_ID = '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc';
const RAILWAY_ENVIRONMENT_ID = '62379618-8890-40fb-bff8-2db75c57027c';

export const SERVICES = Object.freeze([
  {
    name: 'engineering-runner',
    id: 'a8413c73-cc42-483a-9932-c5b644665cf4',
  },
  {
    name: 'engineering-verifier',
    id: 'a97ece8b-6620-4c46-b3d6-9aff9194ec38',
  },
  {
    name: 'browser-worker',
    id: 'e1efd98e-b853-4828-b9bd-b900eab68c19',
  },
  {
    name: 'production-deploy-executor',
    id: '689174b6-63b6-475c-b1c2-c05edb8babf5',
  },
]);

const FULL_SHA = /^[0-9a-f]{40}$/i;
const RESERVATION_ID = /^ATLAS-DISPATCH-[0-9a-f]{64}$/i;
export function dispatcherIdFor(service) {
  if (
    !SERVICES.some(
      (entry) => entry.name === service?.name && entry.id === service?.id,
    )
  ) {
    throw new Error('unsupported executor service');
  }
  return 'atlas-production-deploy-executor:' + service.name;
}

const TERMINAL = new Set([
  'SUCCESS',
  'FAILED',
  'CRASHED',
  'REMOVED',
  'SKIPPED',
]);

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function requireHttpsBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('ATLAS_SUPERVISOR_API_URL must use https');
  }
  return value.replace(/\/+$/g, '');
}

async function readJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  if (!response.ok) {
    const code = body?.code || body?.message || `http_${response.status}`;
    throw new Error(`${label} failed: ${code}`);
  }
  return body;
}

async function railwayGraphql(token, query, variables, fetchImpl) {
  const response = await fetchImpl(RAILWAY_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Project-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(response, 'Railway GraphQL');
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    throw new Error(
      `Railway GraphQL errors: ${JSON.stringify(body.errors)}`,
    );
  }
  if (!body?.data) throw new Error('Railway GraphQL data missing');
  return body.data;
}

export async function verifyRailwayProjectToken(token, fetchImpl = fetch) {
  const data = await railwayGraphql(
    token,
    `query {
      projectToken {
        projectId
        environmentId
      }
    }`,
    {},
    fetchImpl,
  );
  if (
    data?.projectToken?.projectId !== RAILWAY_PROJECT_ID ||
    data?.projectToken?.environmentId !== RAILWAY_ENVIRONMENT_ID
  ) {
    throw new Error('Railway project token scope mismatch');
  }
}

export async function fetchProductionSha(env, fetchImpl = fetch) {
  const repository = required(env, 'GITHUB_REPOSITORY');
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error('unexpected GitHub repository');
  }

  const token = env.GITHUB_TOKEN?.trim() ?? '';
  if (token) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/git/ref/heads/${PRODUCTION_BRANCH}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          authorization: 'Bearer ' + token,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = await readJson(response, 'GitHub production ref');
    const sha = body?.object?.sha?.toLowerCase?.() ?? '';
    if (!FULL_SHA.test(sha)) throw new Error('invalid production SHA');
    return sha;
  }

  const response = await fetchImpl(
    `https://github.com/${repository}.git/info/refs?service=git-upload-pack`,
    {
      headers: {
        accept: 'application/x-git-upload-pack-advertisement',
        'user-agent': 'atlas-production-deploy-executor',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub git ref advertisement failed: http_${response.status}`,
    );
  }
  const advertisement = await response.text();
  const match = advertisement.match(
    /([0-9a-f]{40}) refs\/heads\/production\/atlas(?:\0|\r?\n|$)/i,
  );
  const sha = match?.[1]?.toLowerCase() ?? '';
  if (!FULL_SHA.test(sha)) throw new Error('invalid production SHA');
  return sha;
}

export async function claimDispatch(
  env,
  service,
  sha,
  fetchImpl = fetch,
) {
  if (!SERVICES.some((entry) => entry.name === service.name && entry.id === service.id)) {
    throw new Error('unsupported executor service');
  }
  if (!FULL_SHA.test(sha)) throw new Error('invalid dispatch SHA');

  const apiBase = requireHttpsBase(
    required(env, 'ATLAS_SUPERVISOR_API_URL'),
  );
  const ciToken = required(env, 'ATLAS_SUPERVISOR_CI_TOKEN');
  const repository = required(env, 'GITHUB_REPOSITORY');
  const [repositoryOwner, repositoryName] = repository.split('/');

  const response = await fetchImpl(
    `${apiBase}/engineering/supervisor/gateway/production-deployment/dispatch/claim`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-atlas-supervisor-ci-token': ciToken,
      },
      body: JSON.stringify({
        service: service.name,
        github: {
          repositoryOwner,
          repositoryName,
          branch: PRODUCTION_BRANCH,
          commitSha: sha,
        },
        dispatcherId: dispatcherIdFor(service),
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  const body = await readJson(response, `${service.name} dispatch claim`);
  if (body?.service !== service.name || body?.commitSha !== sha) {
    throw new Error(`${service.name} claim identity mismatch`);
  }

  if (body.claimed === false) {
    if (!['not_found', 'already_reserved'].includes(body.reason)) {
      throw new Error(`${service.name} claim returned invalid reason`);
    }
    return body;
  }

  if (
    body.claimed !== true ||
    typeof body.taskId !== 'string' ||
    typeof body.executionId !== 'string' ||
    !RESERVATION_ID.test(body.reservationId ?? '')
  ) {
    throw new Error(`${service.name} claim proof invalid`);
  }
  return body;
}

export async function deployExactSha(
  railwayToken,
  service,
  sha,
  fetchImpl = fetch,
) {
  const data = await railwayGraphql(
    railwayToken,
    `mutation serviceInstanceDeployV2(
      $serviceId: String!,
      $environmentId: String!,
      $commitSha: String!
    ) {
      serviceInstanceDeployV2(
        serviceId: $serviceId,
        environmentId: $environmentId,
        commitSha: $commitSha
      )
    }`,
    {
      serviceId: service.id,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      commitSha: sha,
    },
    fetchImpl,
  );
  const deploymentId = data?.serviceInstanceDeployV2;
  if (typeof deploymentId !== 'string' || !deploymentId.trim()) {
    throw new Error(`${service.name} deployment ID missing`);
  }
  return deploymentId;
}

export async function getDeployment(
  railwayToken,
  deploymentId,
  fetchImpl = fetch,
) {
  const data = await railwayGraphql(
    railwayToken,
    `query deployment($id: String!) {
      deployment(id: $id) {
        id
        status
        createdAt
        serviceId
        environmentId
        meta
      }
    }`,
    { id: deploymentId },
    fetchImpl,
  );
  if (!data?.deployment) throw new Error('Railway deployment missing');
  return data.deployment;
}

export async function pollDeployment(
  railwayToken,
  service,
  sha,
  deploymentId,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxAttempts = 120,
    intervalMs = 10_000,
    logger = console,
  } = {},
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const deployment = await getDeployment(
      railwayToken,
      deploymentId,
      fetchImpl,
    );
    if (
      deployment.id !== deploymentId ||
      deployment.serviceId !== service.id ||
      deployment.environmentId !== RAILWAY_ENVIRONMENT_ID
    ) {
      throw new Error(`${service.name} Railway deployment identity mismatch`);
    }

    const commitHash = deployment.meta?.commitHash?.toLowerCase?.();
    if (commitHash && commitHash !== sha) {
      throw new Error(`${service.name} Railway deployment SHA mismatch`);
    }

    logger.log('ATLAS_RAILWAY_DEPLOYMENT_STATUS', {
      service: service.name,
      deploymentId,
      attempt,
      status: deployment.status,
      commitSha: commitHash ?? null,
    });

    if (TERMINAL.has(deployment.status)) {
      if (deployment.status !== 'SUCCESS') {
        throw new Error(
          `${service.name} Railway deployment terminal status ${deployment.status}`,
        );
      }
      if (commitHash !== sha) {
        throw new Error(
          `${service.name} successful Railway deployment lacks exact commit proof`,
        );
      }
      return deployment;
    }

    await sleep(intervalMs);
  }
  throw new Error(`${service.name} Railway deployment polling timeout`);
}

export async function execute(
  env = process.env,
  {
    fetchImpl = fetch,
    sleep,
    logger = console,
    maxAttempts,
    intervalMs,
  } = {},
) {
  const railwayToken = required(
    env,
    'ATLAS_RAILWAY_PRODUCTION_PROJECT_TOKEN',
  );

  await verifyRailwayProjectToken(railwayToken, fetchImpl);
  const sha = await fetchProductionSha(env, fetchImpl);
  logger.log('ATLAS_PRODUCTION_DEPLOY_EXECUTOR_SHA', { sha });

  const results = [];
  for (const service of SERVICES) {
    const claim = await claimDispatch(env, service, sha, fetchImpl);
    logger.log('ATLAS_DEPLOY_DISPATCH_CLAIM', {
      service: service.name,
      claimed: claim.claimed,
      reason: claim.reason,
      taskId: claim.taskId ?? null,
      executionId: claim.executionId ?? null,
      reservationId: claim.reservationId ?? null,
      commitSha: sha,
    });

    if (claim.claimed !== true) {
      results.push({ service: service.name, claim, deployment: null });
      continue;
    }

    const deploymentId = await deployExactSha(
      railwayToken,
      service,
      sha,
      fetchImpl,
    );
    logger.log('ATLAS_RAILWAY_EXACT_SHA_DEPLOYMENT_CREATED', {
      service: service.name,
      deploymentId,
      taskId: claim.taskId,
      executionId: claim.executionId,
      reservationId: claim.reservationId,
      commitSha: sha,
    });

    const deployment = await pollDeployment(
      railwayToken,
      service,
      sha,
      deploymentId,
      { fetchImpl, sleep, logger, maxAttempts, intervalMs },
    );
    logger.log('ATLAS_RAILWAY_EXACT_SHA_DEPLOYMENT_SUCCESS', {
      service: service.name,
      deploymentId,
      taskId: claim.taskId,
      executionId: claim.executionId,
      reservationId: claim.reservationId,
      commitSha: sha,
    });
    results.push({ service: service.name, claim, deployment });
  }

  return { sha, results };
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  execute().catch((error) => {
    console.error(
      'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_FAILED',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
