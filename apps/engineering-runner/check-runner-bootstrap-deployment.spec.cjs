'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildVerify, runtimeVerify, gitBlobSha,
} = require('./check-runner-bootstrap-deployment.cjs');

const sha = 'a'.repeat(40);
const parent = 'b'.repeat(40);
const secondParent = 'c'.repeat(40);
const treeSha = 'd'.repeat(40);
const sourceFiles = [
  'apps/engineering-runner/Dockerfile',
  'apps/engineering-runner/check-runner-bootstrap-deployment.cjs',
  'apps/engineering-runner/check-runner-bootstrap-deployment.spec.cjs',
  'apps/engineering-runner/src/bootstrap.ts',
  'apps/engineering-runner/src/bootstrap.spec.ts',
  'package-lock.json',
];
const env = {
  RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
  RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
  RAILWAY_GIT_BRANCH: 'production/atlas',
  RAILWAY_GIT_COMMIT_SHA: sha,
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-source-receipt-'));
  for (const file of sourceFiles) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file + '\n');
  }
  return {
    root,
    receiptPath: path.join(root, 'receipt.json'),
    cleanup: () => fs.rmSync(root, { force: true, recursive: true }),
  };
}

function github(root, options = {}) {
  const blobs = sourceFiles.map(filename => ({
    filename, sha: gitBlobSha(fs.readFileSync(path.join(root, filename))),
    status: 'modified',
  }));
  const tree = sourceFiles.map(filename => ({
    path: filename,
    type: 'blob',
    mode: '100644',
    sha: gitBlobSha(fs.readFileSync(path.join(root, filename))),
  }));
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    let result;
    if (url.includes('/branches/')) {
      result = { commit: { sha: options.branchSha ?? sha } };
    } else if (url.includes('/commits/')) {
      result = {
        sha: options.commitSha ?? sha,
        parents: options.parents ?? [{ sha: parent }, { sha: secondParent }],
        commit: { tree: { sha: options.commitTreeSha ?? treeSha } },
        files: options.files ?? blobs,
      };
    } else if (url.includes('/git/trees/')) {
      result = {
        sha: options.treeSha ?? treeSha,
        truncated: options.truncated ?? false,
        tree: options.tree ?? tree,
      };
    } else {
      throw Error('unexpected_mock_github_endpoint');
    }
    const status = options.statusFor?.(url) ?? 200;
    return {
      ok: status === 200,
      status,
      headers: { get: () => options.linkFor?.(url) ?? null },
      json: async () => result,
    };
  };
  return { fetchImpl, urls, blobs, tree };
}

async function verify(f, options = {}) {
  const gh = github(f.root, options);
  const receipt = await buildVerify({
    env, root: f.root, receiptPath: f.receiptPath,
    fetchImpl: gh.fetchImpl,
  });
  return { receipt, ...gh };
}

test('accepts a later normal two-parent production merge and verifies all tracked GitHub source blobs', async () => {
  const f = fixture();
  try {
    const { receipt, urls } = await verify(f);
    assert.equal(receipt.version, 2);
    assert.equal(receipt.commitSha, sha);
    assert.equal(receipt.treeSha, treeSha);
    assert.deepEqual(receipt.parents, [parent, secondParent]);
    assert.equal(Object.keys(receipt.blobs).length, sourceFiles.length);
    assert.deepEqual(receipt.files, sourceFiles);
    assert.equal(urls.length, 3);
    assert.equal(runtimeVerify({
      env, root: f.root, receiptPath: f.receiptPath,
    }).commitSha, sha);
  } finally { f.cleanup(); }
});

test('accepts a subsequent single-parent commit only when canonical branch head and tree match', async () => {
  const f = fixture();
  try {
    const { receipt } = await verify(f, { parents: [{ sha: parent }] });
    assert.deepEqual(receipt.parents, [parent]);
  } finally { f.cleanup(); }
});

test('rejects missing or wrong Railway Git identity without requesting GitHub', async () => {
  const f = fixture();
  try {
    const { fetchImpl, urls } = github(f.root);
    await assert.rejects(buildVerify({
      env: { ...env, RAILWAY_GIT_BRANCH: 'main' },
      root: f.root, receiptPath: f.receiptPath, fetchImpl,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY RAILWAY_GIT_BRANCH/);
    assert.equal(urls.length, 0);
  } finally { f.cleanup(); }
});

test('rejects a SHA not at the canonical production branch HEAD', async () => {
  const f = fixture();
  try {
    await assert.rejects(verify(f, { branchSha: 'e'.repeat(40) }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY canonical_head/);
  } finally { f.cleanup(); }
});

test('fails closed on GitHub 403, missing response and incomplete paginated commit', async () => {
  const f = fixture();
  try {
    await assert.rejects(verify(f, {
      statusFor: url => url.includes('/branches/') ? 403 : 200,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY branch_403/);
    await assert.rejects(verify(f, {
      statusFor: url => url.includes('/commits/') ? 403 : 200,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY commit_403/);
    await assert.rejects(verify(f, {
      linkFor: url => url.includes('/commits/') ? '<next>; rel="next"' : null,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY commit_incomplete/);
  } finally { f.cleanup(); }
});

test('rejects wrong commit SHA, missing tree SHA and invalid parent count or ancestry', async () => {
  const f = fixture();
  try {
    await assert.rejects(verify(f, { commitSha: 'e'.repeat(40) }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY sha/);
    await assert.rejects(verify(f, { commitTreeSha: 'bad' }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY tree_sha/);
    for (const parents of [
      [], [{ sha: sha }], [{ sha: parent }, { sha: parent }],
      [{ sha: parent }, { sha: secondParent }, { sha: 'e'.repeat(40) }],
    ]) {
      await assert.rejects(verify(f, { parents }),
        /ATLAS_RUNNER_BOOTSTRAP_DENY parent/);
    }
  } finally { f.cleanup(); }
});

test('rejects truncated or mismatched GitHub source trees', async () => {
  const f = fixture();
  try {
    await assert.rejects(verify(f, { truncated: true }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY tree_incomplete/);
    await assert.rejects(verify(f, { treeSha: 'e'.repeat(40) }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY tree_incomplete/);
  } finally { f.cleanup(); }
});

test('rejects missing, duplicated, traversal, symlink or unsupported tracked file paths', async () => {
  const f = fixture();
  try {
    const { tree } = github(f.root);
    for (const entries of [
      [], [...tree, tree[0]],
      [...tree, { ...tree[0], path: '../secret' }],
      [...tree, { ...tree[0], path: '/etc/passwd' }],
      [...tree, { ...tree[0], path: 'bad\\path' }],
      [...tree, { ...tree[0], path: 'bad/link', mode: '120000' }],
      [...tree, { ...tree[0], path: 'bad/submodule', type: 'commit' }],
    ]) {
      await assert.rejects(verify(f, { tree: entries }),
        /ATLAS_RUNNER_BOOTSTRAP_DENY (source_tree_|unsupported_tree_type)/);
    }
  } finally { f.cleanup(); }
});

test('rejects a commit file not present in the canonical source tree or with a wrong blob', async () => {
  const f = fixture();
  try {
    const { blobs } = github(f.root);
    await assert.rejects(verify(f, {
      files: [{ ...blobs[0], sha: 'e'.repeat(40) }, ...blobs.slice(1)],
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY changed_tree_blob_/);
    await assert.rejects(verify(f, {
      files: [{ filename: 'untracked.txt', sha: 'e'.repeat(40), status: 'added' }],
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY changed_tree_blob_/);
  } finally { f.cleanup(); }
});

test('rejects ambiguous changed files, deletes, renames and traversal instead of weakening image proofs', async () => {
  const f = fixture();
  try {
    const { blobs } = github(f.root);
    for (const files of [
      [], [blobs[0], blobs[0]],
      [{ ...blobs[0], status: 'removed' }],
      [{ ...blobs[0], status: 'renamed' }],
      [{ ...blobs[0], filename: '../out' }],
    ]) {
      await assert.rejects(verify(f, { files }),
        /ATLAS_RUNNER_BOOTSTRAP_DENY changed_file/);
    }
  } finally { f.cleanup(); }
});

test('rejects any local image source bytes not matching the canonical GitHub tree', async () => {
  const f = fixture();
  try {
    const remote = github(f.root);
    fs.writeFileSync(path.join(f.root, sourceFiles[3]), 'tampered\n');
    await assert.rejects(buildVerify({
      env, root: f.root, receiptPath: f.receiptPath,
      fetchImpl: remote.fetchImpl,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY source_blob_/);
  } finally { f.cleanup(); }
});

test('rejects source-tree missing image files and symlinks', async () => {
  const f = fixture();
  try {
    const remote = github(f.root);
    const victim = path.join(f.root, sourceFiles[3]);
    fs.rmSync(victim);
    await assert.rejects(buildVerify({
      env, root: f.root, receiptPath: f.receiptPath,
      fetchImpl: remote.fetchImpl,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY missing_source_blob_/);
    fs.symlinkSync(path.join(f.root, sourceFiles[4]), victim);
    await assert.rejects(buildVerify({
      env, root: f.root, receiptPath: f.receiptPath,
      fetchImpl: remote.fetchImpl,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY nonregular_source_/);
  } finally { f.cleanup(); }
});

test('runtime gate fails closed on missing receipt', () => {
  const f = fixture();
  try {
    assert.throws(() => runtimeVerify({
      env, root: f.root, receiptPath: f.receiptPath,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY missing_build_receipt/);
  } finally { f.cleanup(); }
});

test('runtime rejects stale receipt, commit drift, altered receipt source scope and post-build source drift', async () => {
  const f = fixture();
  try {
    await verify(f);
    assert.throws(() => runtimeVerify({
      env: { ...env, RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40) },
      root: f.root, receiptPath: f.receiptPath,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY receipt_identity/);
    const original = fs.readFileSync(f.receiptPath, 'utf8');
    fs.chmodSync(f.receiptPath, 0o600);
    fs.writeFileSync(f.receiptPath,
      JSON.stringify({ ...JSON.parse(original), version: 1 }));
    assert.throws(() => runtimeVerify({
      env, root: f.root, receiptPath: f.receiptPath,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY receipt_identity/);
    fs.writeFileSync(f.receiptPath, original);
    fs.writeFileSync(path.join(f.root, sourceFiles[2]), 'post-build drift\n');
    assert.throws(() => runtimeVerify({
      env, root: f.root, receiptPath: f.receiptPath,
    }), /ATLAS_RUNNER_BOOTSTRAP_DENY receipt_blob_/);
  } finally { f.cleanup(); }
});
