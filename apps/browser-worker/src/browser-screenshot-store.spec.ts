import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  browserScreenshotResponse,
  screenshotPathIsInsideRoot,
} from './browser-screenshot-store.js';

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

test('screenshot response omits base64 without encoding it', () => {
  let encoded = false;
  const buffer = Buffer.from('image-bytes');
  const originalToString = buffer.toString.bind(buffer);

  buffer.toString = ((encoding?: BufferEncoding) => {
    if (encoding === 'base64') encoded = true;
    return originalToString(encoding);
  }) as typeof buffer.toString;

  const saved = {
    absolutePath: '/data/browser-screenshots/capture.jpg',
    relativePath: 'capture.jpg',
    filename: 'capture.jpg',
  };
  const response = browserScreenshotResponse({
    buffer,
    saved,
    includeBase64: false,
  });

  assert.equal(encoded, false);
  assert.equal('base64' in response, false);
  assert.deepEqual(response, {
    mimeType: 'image/jpeg',
    ...saved,
  });
});

test('screenshot response keeps base64 for interactive callers', () => {
  const buffer = Buffer.from('image-bytes');
  const saved = {
    absolutePath: '/data/browser-screenshots/capture.jpg',
    relativePath: 'capture.jpg',
    filename: 'capture.jpg',
  };
  const response = browserScreenshotResponse({
    buffer,
    saved,
    includeBase64: true,
  });

  assert.equal(response.base64, buffer.toString('base64'));
  assert.equal(response.absolutePath, saved.absolutePath);
  assert.equal(response.relativePath, saved.relativePath);
  assert.equal(response.filename, saved.filename);
});
