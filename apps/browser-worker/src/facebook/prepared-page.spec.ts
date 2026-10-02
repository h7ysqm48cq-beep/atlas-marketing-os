import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePreparedPage } from './prepared-page.js';

test('closes and clears the tracked Facebook review page', async () => {
  let closeCount = 0;
  const page = {
    isClosed: () => false,
    close: async () => {
      closeCount += 1;
    },
  };
  const owner = { preparedPage: page };

  await releasePreparedPage(owner);

  assert.equal(closeCount, 1);
  assert.equal(owner.preparedPage, null);
});
