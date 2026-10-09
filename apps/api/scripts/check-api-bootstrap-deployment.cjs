'use strict';

const OWNER = 'h7ysqm48cq-beep';
const REPO = 'atlas-marketing-os';
const BRANCH = 'production/atlas';
const EXPECTED_PR_NUMBER = 422;
const EXPECTED_HEAD_BRANCH = 'atlas/api-emergency-bootstrap-recovery-20261009';
// Temporary API-only recovery for the 2026-10-09 control-plane cold-start
// self-dependency. Restore the normal repository pre-deploy + runtime-start
// Supervisor gates in a separate reviewed PR immediately after API recovery.
// This is NOT Supervisor approval and must never be logged as one.
const EXPECTED_PARENT = '17ce970f69551231cffc9c431c578775cc7e38e9';
const EXPECTED_SERVICE_ID = 'c23120f6-5d60-44d6-8021-9d6c52387718';
const EXPECTED_ENVIRONMENT_ID = '62379618-8890-40fb-bff8-2db75c57027c';
const EXPIRES_AT = Date.parse('2026-10-09T09:30:00Z');
const ALLOWED_FILES = new Set([
  'railway.json',
  'apps/api/scripts/check-api-bootstrap-deployment.cjs',
  'apps/api/src/agent-supervisor/gateway/repository-production-deployment-gate.spec.ts',
]);

function requireExact(env, key, expected) {
  if (env[key] !== expected) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY ' + key);
  }
}

async function main(env = process.env, fetchImpl = globalThis.fetch, now = Date.now()) {
  requireExact(env, 'RAILWAY_GIT_REPO_OWNER', OWNER);
  requireExact(env, 'RAILWAY_GIT_REPO_NAME', REPO);
  requireExact(env, 'RAILWAY_GIT_BRANCH', BRANCH);
  requireExact(env, 'RAILWAY_SERVICE_ID', EXPECTED_SERVICE_ID);
  requireExact(env, 'RAILWAY_ENVIRONMENT_ID', EXPECTED_ENVIRONMENT_ID);
  if (env.ATLAS_DEPLOYMENT_SERVICE !== undefined) {
    requireExact(env, 'ATLAS_DEPLOYMENT_SERVICE', 'api');
  }
  if (!Number.isFinite(now) || now >= EXPIRES_AT) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY expired');
  }
  const sha = env.RAILWAY_GIT_COMMIT_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha || '') || sha === EXPECTED_PARENT) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY commit');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY fetch');
  }
  async function github(path) {
    const response = await fetchImpl(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/' + path,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'atlas-api-bootstrap-check',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      throw new Error('ATLAS_API_BOOTSTRAP_DENY github_' + response.status);
    }
    return response.json();
  }
  const branch = await github('branches/production%2Fatlas');
  if (branch.commit?.sha !== sha || branch.name !== BRANCH) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY production_tip');
  }
  const commit = await github('commits/' + sha);
  if (commit.sha !== sha) throw new Error('ATLAS_API_BOOTSTRAP_DENY sha');
  const parentShas = Array.isArray(commit.parents)
    ? commit.parents.map(function (parent) { return parent?.sha; })
    : [];
  if (parentShas.length !== 2 ||
      !parentShas.every(function (parentSha) {
        return typeof parentSha === 'string' &&
          /^[0-9a-f]{40}$/i.test(parentSha);
      }) ||
      parentShas[0] !== EXPECTED_PARENT) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY parent');
  }
  if (!Array.isArray(commit.files)) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY scope');
  }
  const files = commit.files.map(function (file) { return file?.filename; });
  const invalidFileEntry = commit.files.some(function (file) {
    return !file ||
      typeof file.filename !== 'string' ||
      file.status !== 'modified' ||
      Object.prototype.hasOwnProperty.call(file, 'previous_filename');
  });
  const uniqueFiles = new Set(files);
  if (invalidFileEntry ||
      files.length !== ALLOWED_FILES.size ||
      uniqueFiles.size !== ALLOWED_FILES.size ||
      files.some(function (file) { return !ALLOWED_FILES.has(file); })) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY scope');
  }
  files.sort();

  const secondParent = parentShas[1];
  const pulls = await github('commits/' + sha + '/pulls');
  if (!Array.isArray(pulls)) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY pr_identity');
  }
  const matchingPulls = pulls.filter(function (pull) {
    const mergedAtMs = typeof pull?.merged_at === 'string'
      ? Date.parse(pull.merged_at)
      : Number.NaN;
    const headSha = pull?.head?.sha;
    return pull?.number === EXPECTED_PR_NUMBER &&
      pull?.state === 'closed' &&
      typeof pull?.merged_at === 'string' &&
      pull.merged_at.length > 0 &&
      Number.isFinite(mergedAtMs) &&
      pull?.merge_commit_sha === sha &&
      pull?.base?.ref === BRANCH &&
      pull?.base?.sha === EXPECTED_PARENT &&
      pull?.head?.ref === EXPECTED_HEAD_BRANCH &&
      typeof headSha === 'string' &&
      /^[0-9a-f]{40}$/i.test(headSha) &&
      headSha === secondParent;
  });
  if (matchingPulls.length !== 1) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY pr_identity');
  }

  console.log('ATLAS_API_BOOTSTRAP_EXCEPTION_NOT_SUPERVISOR_APPROVAL', {
    commitSha: sha,
    parent: EXPECTED_PARENT,
    service: 'api',
    expiresAt: new Date(EXPIRES_AT).toISOString(),
    pullRequestNumber: EXPECTED_PR_NUMBER,
    recoveryHeadBranch: EXPECTED_HEAD_BRANCH,
    scope: files,
  });
}

module.exports = { main };

if (require.main === module) {
  main().catch(function (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
