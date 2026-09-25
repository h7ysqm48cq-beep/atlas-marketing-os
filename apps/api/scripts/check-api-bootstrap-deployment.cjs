'use strict';

const OWNER = 'h7ysqm48cq-beep';
const REPO = 'atlas-marketing-os';
const BRANCH = 'production/atlas';
// Temporary API-only recovery. Restore the normal repository deployment gate
// in a separate reviewed PR after the new API can issue real deployment receipts.
// This is NOT Supervisor approval and must never be logged as one.
const EXPECTED_PARENT = 'aa46291585a73ba5bed86b18b29cd47fb8c2cfd2';
const EXPECTED_SERVICE_ID = 'c23120f6-5d60-44d6-8021-9d6c52387718';
const EXPECTED_ENVIRONMENT_ID = '62379618-8890-40fb-bff8-2db75c57027c';
const EXPIRES_AT = Date.parse('2026-09-26T03:00:00Z');
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
  if (!Array.isArray(commit.parents) ||
      commit.parents.length !== 2 ||
      (commit.parents[0] || {}).sha !== EXPECTED_PARENT) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY parent');
  }
  if (!Array.isArray(commit.files)) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY scope');
  }
  const files = commit.files.map(function (file) { return file.filename; }).sort();
  if (files.length !== ALLOWED_FILES.size ||
      files.some(function (file) { return !ALLOWED_FILES.has(file); })) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY scope');
  }
  console.log('ATLAS_API_BOOTSTRAP_EXCEPTION_NOT_SUPERVISOR_APPROVAL', {
    commitSha: sha,
    parent: EXPECTED_PARENT,
    service: 'api',
    expiresAt: new Date(EXPIRES_AT).toISOString(),
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
