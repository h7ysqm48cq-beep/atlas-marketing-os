'use strict';

const OWNER = 'h7ysqm48cq-beep';
const REPO = 'atlas-marketing-os';
const BRANCH = 'production/atlas';
const EXPECTED_PARENT = 'b7b3db8dc1a535f6171a88baca76003ed31fc71e';
const ALLOWED_FILES = new Set([
  'railway.json',
  'apps/api/scripts/check-api-bootstrap-deployment.cjs',
]);

function requireExact(env, key, expected) {
  if (env[key] !== expected) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY ' + key);
  }
}

async function main(env = process.env, fetchImpl = globalThis.fetch) {
  requireExact(env, 'RAILWAY_GIT_REPO_OWNER', OWNER);
  requireExact(env, 'RAILWAY_GIT_REPO_NAME', REPO);
  requireExact(env, 'RAILWAY_GIT_BRANCH', BRANCH);
  const sha = env.RAILWAY_GIT_COMMIT_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha || '')) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY commit');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY fetch');
  }
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/commits/' + sha;
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'atlas-api-bootstrap-check',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY github_' + response.status);
  }
  const commit = await response.json();
  if (commit.sha !== sha) throw new Error('ATLAS_API_BOOTSTRAP_DENY sha');
  if (!Array.isArray(commit.parents) ||
      commit.parents.length < 1 ||
      (commit.parents[0] || {}).sha !== EXPECTED_PARENT) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY parent');
  }
  const files = (commit.files || []).map(function (file) { return file.filename; }).sort();
  if (files.length !== ALLOWED_FILES.size ||
      files.some(function (file) { return !ALLOWED_FILES.has(file); })) {
    throw new Error('ATLAS_API_BOOTSTRAP_DENY scope');
  }
  console.log('ATLAS_API_BOOTSTRAP_ALLOW', {
    commitSha: sha,
    parent: EXPECTED_PARENT,
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
