'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 'h7ysqm48cq-beep';
const REPO = 'atlas-marketing-os';
const BRANCH = 'production/atlas';
const SERVICE = 'engineering-runner';
const MAX_SOURCE_FILES = 10000;
const ROOT = path.resolve(__dirname, '../..');
const RECEIPT = path.join(__dirname, '.bootstrap-verified.json');

function deny(reason) {
  throw new Error('ATLAS_RUNNER_BOOTSTRAP_DENY ' + reason);
}

function gitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
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
  if (!gitSha(env.RAILWAY_GIT_COMMIT_SHA)) deny('commit');
  return env.RAILWAY_GIT_COMMIT_SHA;
}

function gitBlobSha(bytes) {
  return crypto.createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
}

function validPath(file) {
  return typeof file === 'string' &&
    file.length > 0 &&
    !file.includes('\\') &&
    !file.includes('\0') &&
    !path.posix.isAbsolute(file) &&
    file.split('/').every(part => part && part !== '.' && part !== '..');
}

function sourceBlobs(root, files, readFile, lstat = fs.lstatSync) {
  const blobs = Object.create(null);
  for (const file of files) {
    if (!validPath(file)) deny('unsafe_source_path');
    const target = path.join(root, file);
    try {
      if (!lstat(target).isFile()) deny('nonregular_source_' + file);
      blobs[file] = gitBlobSha(readFile(target));
    } catch (error) {
      if (error?.message?.startsWith('ATLAS_RUNNER_BOOTSTRAP_DENY ')) throw error;
      deny('missing_source_blob_' + file);
    }
  }
  return blobs;
}

function checkedFiles(files) {
  if (!Array.isArray(files) || files.length < 1 ||
      files.length > MAX_SOURCE_FILES) deny('source_tree_count');
  const names = files.map(f => f?.path);
  if (names.some(f => !validPath(f)) ||
      new Set(names).size !== names.length) deny('source_tree_paths');
  for (const f of files) {
    if (f?.type !== 'blob' || !['100644', '100755'].includes(f.mode) ||
        !gitSha(f.sha)) deny('source_tree_entry');
  }
  return names;
}

async function githubJson(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'atlas-runner-build-attestation',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    deny(label + '_unreachable');
  }
  if (!response?.ok) deny(label + '_' + response?.status);
  if (response.headers?.get?.('link')?.includes('rel="next"')) {
    deny(label + '_incomplete');
  }
  try {
    return await response.json();
  } catch {
    deny(label + '_invalid_json');
  }
}

function checkedCommit(commit, sha) {
  if (commit?.sha !== sha) deny('sha');
  if (!Array.isArray(commit.parents) ||
      ![1, 2].includes(commit.parents.length) ||
      commit.parents.some(p => !gitSha(p?.sha) || p.sha === sha) ||
      new Set(commit.parents.map(p => p.sha)).size !== commit.parents.length) {
    deny('parent');
  }
  const treeSha = commit.commit?.tree?.sha;
  if (!gitSha(treeSha)) deny('tree_sha');
  const files = commit.files;
  if (!Array.isArray(files) || files.length < 1 ||
      files.length > 300 ||
      new Set(files.map(f => f?.filename)).size !== files.length) {
    deny('changed_files');
  }
  // Deletions/renames need explicit image-source semantics; do not guess.
  for (const f of files) {
    if (!validPath(f?.filename) ||
        !['added', 'modified', 'changed'].includes(f?.status) ||
        !gitSha(f?.sha)) deny('changed_file_entry');
  }
  return { treeSha, files };
}

async function buildVerify({
  env = process.env,
  fetchImpl = globalThis.fetch,
  root = ROOT,
  receiptPath = RECEIPT,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
  lstat = fs.lstatSync,
} = {}) {
  const sha = identity(env);
  if (typeof fetchImpl !== 'function') deny('fetch');
  const githubRoot = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  const branch = await githubJson(
    fetchImpl, githubRoot + '/branches/' + encodeURIComponent(BRANCH), 'branch',
  );
  if (branch?.commit?.sha !== sha) deny('canonical_head');
  const commit = await githubJson(
    fetchImpl, githubRoot + '/commits/' + sha, 'commit',
  );
  const { treeSha, files } = checkedCommit(commit, sha);
  const tree = await githubJson(
    fetchImpl, githubRoot + '/git/trees/' + treeSha + '?recursive=1', 'tree',
  );
  if (tree?.sha !== treeSha || tree.truncated !== false ||
      !Array.isArray(tree.tree)) deny('tree_incomplete');
  if (tree.tree.some(f => f?.type !== 'tree' && f?.type !== 'blob')) {
    deny('unsupported_tree_type');
  }
  const tracked = tree.tree.filter(f => f.type === 'blob');
  const paths = checkedFiles(tracked);
  const remoteBlobs = Object.fromEntries(tracked.map(f => [f.path, f.sha]));
  for (const file of files) {
    if (remoteBlobs[file.filename] !== file.sha) {
      deny('changed_tree_blob_' + file.filename);
    }
  }
  const localBlobs = sourceBlobs(root, paths, readFile, lstat);
  for (const file of paths) {
    if (localBlobs[file] !== remoteBlobs[file]) {
      deny('source_blob_' + file);
    }
  }
  const receipt = {
    version: 2,
    repo: OWNER + '/' + REPO,
    branch: BRANCH,
    service: SERVICE,
    commitSha: sha,
    treeSha,
    parents: commit.parents.map(p => p.sha),
    files: files.map(f => f.filename),
    blobs: localBlobs,
  };
  writeFile(receiptPath, JSON.stringify(receipt) + '\n', { mode: 0o444 });
  console.log('ATLAS_RUNNER_BOOTSTRAP_BUILD_VERIFIED', {
    service: SERVICE,
    commitSha: sha,
    scopeCount: paths.length,
    changedCount: files.length,
  });
  return receipt;
}

function runtimeVerify({
  env = process.env,
  root = ROOT,
  receiptPath = RECEIPT,
  readFile = fs.readFileSync,
  lstat = fs.lstatSync,
} = {}) {
  const sha = identity(env);
  let receipt;
  try {
    receipt = JSON.parse(readFile(receiptPath, 'utf8'));
  } catch {
    deny('missing_build_receipt');
  }
  if (receipt?.version !== 2 ||
      receipt.repo !== OWNER + '/' + REPO ||
      receipt.branch !== BRANCH ||
      receipt.service !== SERVICE ||
      receipt.commitSha !== sha ||
      !gitSha(receipt.treeSha) ||
      !Array.isArray(receipt.parents) ||
      ![1, 2].includes(receipt.parents.length) ||
      receipt.parents.some(p => !gitSha(p) || p === sha) ||
      new Set(receipt.parents).size !== receipt.parents.length ||
      !Array.isArray(receipt.files) ||
      receipt.files.length < 1 || receipt.files.length > 300 ||
      receipt.files.some(f => !validPath(f)) ||
      new Set(receipt.files).size !== receipt.files.length ||
      !receipt.blobs || typeof receipt.blobs !== 'object' ||
      Array.isArray(receipt.blobs)) {
    deny('receipt_identity');
  }
  const paths = Object.keys(receipt.blobs);
  checkedFiles(paths.map(f => ({
    path: f, type: 'blob', mode: '100644', sha: receipt.blobs[f],
  })));
  if (receipt.files.some(f => !Object.hasOwn(receipt.blobs, f))) {
    deny('receipt_scope');
  }
  const local = sourceBlobs(root, paths, readFile, lstat);
  for (const file of paths) {
    if (receipt.blobs[file] !== local[file]) {
      deny('receipt_blob_' + file);
    }
  }
  console.log('ATLAS_RUNNER_BOOTSTRAP_ALLOW', {
    service: SERVICE,
    commitSha: sha,
    scopeCount: paths.length,
    method: 'verified_image_receipt',
  });
  return receipt;
}

module.exports = { buildVerify, runtimeVerify, gitBlobSha };

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
