'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 'h7ysqm48cq-beep';
const REPO = 'atlas-marketing-os';
const BRANCH = 'production/atlas';
const SERVICE = 'engineering-runner';
const EXPECTED_PARENT = '39dc4941b7e0dc6fa01b79fac851b35eaba25cf8';
const ALLOWED_FILES = [
  'apps/engineering-runner/Dockerfile',
  'apps/engineering-runner/check-runner-bootstrap-deployment.cjs',
  'apps/engineering-runner/check-runner-bootstrap-deployment.spec.cjs',
];
const ROOT = path.resolve(__dirname, '../..');
const RECEIPT = path.join(__dirname, '.bootstrap-verified.json');

function deny(reason) {
  throw new Error('ATLAS_RUNNER_BOOTSTRAP_DENY ' + reason);
}

function identity(env) {
  const expected = {
    RAILWAY_GIT_REPO_OWNER: OWNER,
    RAILWAY_GIT_REPO_NAME: REPO,
    RAILWAY_GIT_BRANCH: BRANCH,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) deny(key);
  }
  const sha = env.RAILWAY_GIT_COMMIT_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha || '')) deny('commit');
  return sha;
}

function gitBlobSha(bytes) {
  return crypto.createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
}

function sourceBlobs(root, readFile) {
  const blobs = {};
  for (const filename of ALLOWED_FILES) {
    try {
      blobs[filename] = gitBlobSha(readFile(path.join(root, filename)));
    } catch {
      deny('missing_source_blob_' + filename);
    }
  }
  return blobs;
}

function sameFiles(actual) {
  return Array.isArray(actual) &&
    actual.length === ALLOWED_FILES.length &&
    new Set(actual).size === ALLOWED_FILES.length &&
    actual.every(file => ALLOWED_FILES.includes(file));
}

async function buildVerify({
  env = process.env,
  fetchImpl = globalThis.fetch,
  root = ROOT,
  receiptPath = RECEIPT,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
} = {}) {
  const sha = identity(env);
  if (typeof fetchImpl !== 'function') deny('fetch');
  let response;
  try {
    response = await fetchImpl(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/commits/' + sha,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'atlas-runner-build-attestation',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    deny('github_unreachable');
  }
  if (!response.ok) deny('github_' + response.status);
  let commit;
  try {
    commit = await response.json();
  } catch {
    deny('github_invalid_json');
  }
  if (commit?.sha !== sha) deny('sha');
  if (!Array.isArray(commit.parents) ||
    (commit.parents.length !== 1 && commit.parents.length !== 2) ||
    commit.parents[0]?.sha !== EXPECTED_PARENT) {
    deny('parent');
  }
  const files = (commit.files || []).map(f => f.filename);
  if (!sameFiles(files)) deny('scope');
  const localBlobs = sourceBlobs(root, readFile);
  for (const file of commit.files) {
    if (!/^[0-9a-f]{40}$/.test(file.sha || '') ||
      localBlobs[file.filename] !== file.sha) {
      deny('source_blob_' + file.filename);
    }
  }
  const receipt = {
    version: 1,
    repo: OWNER + '/' + REPO,
    branch: BRANCH,
    service: SERVICE,
    commitSha: sha,
    parent: EXPECTED_PARENT,
    files: ALLOWED_FILES,
    blobs: localBlobs,
  };
  writeFile(receiptPath, JSON.stringify(receipt) + '\n', { mode: 0o444 });
  console.log('ATLAS_RUNNER_BOOTSTRAP_BUILD_VERIFIED', {
    service: SERVICE,
    commitSha: sha,
    scopeCount: ALLOWED_FILES.length,
  });
  return receipt;
}

function runtimeVerify({
  env = process.env,
  root = ROOT,
  receiptPath = RECEIPT,
  readFile = fs.readFileSync,
} = {}) {
  const sha = identity(env);
  let receipt;
  try {
    receipt = JSON.parse(readFile(receiptPath, 'utf8'));
  } catch {
    deny('missing_build_receipt');
  }
  if (receipt.version !== 1 ||
      receipt.repo !== OWNER + '/' + REPO ||
      receipt.branch !== BRANCH ||
      receipt.service !== SERVICE ||
      receipt.parent !== EXPECTED_PARENT ||
      receipt.commitSha !== sha ||
      !sameFiles(receipt.files)) {
    deny('receipt_identity');
  }
  const localBlobs = sourceBlobs(root, readFile);
  for (const file of ALLOWED_FILES) {
    if (receipt.blobs?.[file] !== localBlobs[file]) {
      deny('receipt_blob_' + file);
    }
  }
  console.log('ATLAS_RUNNER_BOOTSTRAP_ALLOW', {
    service: SERVICE,
    commitSha: sha,
    scopeCount: ALLOWED_FILES.length,
    method: 'verified_image_receipt',
  });
  return receipt;
}

module.exports = { buildVerify, runtimeVerify, gitBlobSha, ALLOWED_FILES };

if (require.main === module) {
  const operation = process.argv[2];
  const job = operation === '--build-verify'
    ? buildVerify()
    : operation === undefined
      ? Promise.resolve().then(() => runtimeVerify())
      : Promise.reject(new Error('ATLAS_RUNNER_BOOTSTRAP_DENY unsupported_operation'));
  job.catch(error => {
    console.error(error instanceof Error ? error.message :
      'ATLAS_RUNNER_BOOTSTRAP_DENY unknown');
    process.exitCode = 1;
  });
}
