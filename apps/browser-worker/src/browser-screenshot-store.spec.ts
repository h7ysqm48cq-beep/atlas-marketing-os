import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { screenshotPathIsInsideRoot } from './browser-screenshot-store.js';

test('screenshot archive containment rejects traversal and sibling prefixes', () => {
  const root = path.join('/data', 'browser-screenshots');

  assert.equal(
    screenshotPathIsInsideRoot(root, path.join(root, '2026', 'capture.jpg')),
    true,
  );
  assert.equal(
    screenshotPathIsInsideRoot(root, path.join(root, '..', 'secrets.txt')),
    false,
  );
  assert.equal(
    screenshotPathIsInsideRoot(root, '/data/browser-screenshots-old/capture.jpg'),
    false,
  );
});
