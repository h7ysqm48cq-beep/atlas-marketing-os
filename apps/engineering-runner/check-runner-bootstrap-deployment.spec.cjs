'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildVerify, runtimeVerify, gitBlobSha, ALLOWED_FILES,
} = require('./check-runner-bootstrap-deployment.cjs');

const sha = 'a'.repeat(40);
const parent = '39dc4941b7e0dc6fa01b79fac851b35eaba25cf8';
const env = {
  RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
  RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
  RAILWAY_GIT_BRANCH: 'production/atlas',
  RAILWAY_GIT_COMMIT_SHA: sha,
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-build-receipt-'));
  for (const file of ALLOWED_FILES) {
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
  const files = ALLOWED_FILES.map(filename => ({
    filename,
    sha: gitBlobSha(fs.readFileSync(path.join(root, filename))),
  }));
  return async () => ({
    ok: options.status === undefined || options.status === 200,
    status: options.status || 200,
    json: async () => ({
      sha: options.sha || sha,
      parents: options.parents || [{ sha: parent }, { sha: 'b'.repeat(40) }],
      files: options.files || files,
    }),
  });
}

test('build verifies exact Git source blobs; runtime uses the image receipt without network', async () => {
  const f = fixture();
  try {
    const r = await buildVerify({
      env, root: f.root, receiptPath: f.receiptPath,
      fetchImpl: github(f.root),
    });
    assert.equal(r.commitSha, sha);
    assert.equal(r.files.length, 3);
    assert.equal(
      runtimeVerify({ env, root: f.root, receiptPath: f.receiptPath }).commitSha,
      sha,
    );
  } finally { f.cleanup(); }
});

test('rejects absent Git metadata without fetching', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      buildVerify({
        env: { ...env, RAILWAY_GIT_BRANCH: undefined },
        root: f.root, receiptPath: f.receiptPath,
        fetchImpl: () => { throw new Error('must_not_fetch'); },
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY RAILWAY_GIT_BRANCH/,
    );
  } finally { f.cleanup(); }
});

test('rejects GitHub rate-limit at build time where errors are visible', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      buildVerify({
        env, root: f.root, receiptPath: f.receiptPath,
        fetchImpl: github(f.root, { status: 403 }),
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY github_403/,
    );
  } finally { f.cleanup(); }
});

test('rejects altered merge parent', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      buildVerify({
        env, root: f.root, receiptPath: f.receiptPath,
        fetchImpl: github(f.root, {
          parents: [{ sha: 'c'.repeat(40) }, { sha: 'b'.repeat(40) }],
        }),
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY parent/,
    );
  } finally { f.cleanup(); }
});

test('rejects unapproved or duplicate commit paths', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      buildVerify({
        env, root: f.root, receiptPath: f.receiptPath,
        fetchImpl: github(f.root, {
          files: [
            { filename: ALLOWED_FILES[0] },
            { filename: ALLOWED_FILES[0] },
            { filename: ALLOWED_FILES[2] },
          ],
        }),
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY scope/,
    );
  } finally { f.cleanup(); }
});

test('rejects image source bytes that differ from GitHub blob hashes', async () => {
  const f = fixture();
  try {
    const mocked = await github(f.root)();
    mocked.json = async () => {
      const files = ALLOWED_FILES.map(filename => ({
        filename, sha: 'd'.repeat(40),
      }));
      return {
        sha, parents: [{ sha: parent }, { sha: 'b'.repeat(40) }], files,
      };
    };
    await assert.rejects(
      buildVerify({
        env, root: f.root, receiptPath: f.receiptPath,
        fetchImpl: async () => mocked,
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY source_blob_/,
    );
  } finally { f.cleanup(); }
});

test('predeploy fails closed without build receipt', () => {
  const f = fixture();
  try {
    assert.throws(
      () => runtimeVerify({
        env, root: f.root, receiptPath: f.receiptPath,
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY missing_build_receipt/,
    );
  } finally { f.cleanup(); }
});

test('predeploy rejects commit mismatch and post-build source drift', async () => {
  const f = fixture();
  try {
    await buildVerify({
      env, root: f.root, receiptPath: f.receiptPath,
      fetchImpl: github(f.root),
    });
    assert.throws(
      () => runtimeVerify({
        env: { ...env, RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40) },
        root: f.root, receiptPath: f.receiptPath,
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY receipt_identity/,
    );
    fs.writeFileSync(path.join(f.root, ALLOWED_FILES[0]), 'tampered\n');
    assert.throws(
      () => runtimeVerify({
        env, root: f.root, receiptPath: f.receiptPath,
      }),
      /ATLAS_RUNNER_BOOTSTRAP_DENY receipt_blob_/,
    );
  } finally { f.cleanup(); }
});

test('accepts frozen single-parent PR head for isolated build verification', async () => {
  const f = fixture();
  try {
    const r = await buildVerify({
      env, root: f.root, receiptPath: f.receiptPath,
      fetchImpl: github(f.root, { parents: [{ sha: parent }] }),
    });
    assert.equal(r.parent, parent);
  } finally { f.cleanup(); }
});
