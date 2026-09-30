import assert from 'node:assert/strict';
import test from 'node:test';
import { runDaemon } from './atlas-production-deploy-executor-daemon.mjs';

test('daemon executes immediately before its first sleep', async () => {
  const controller = new AbortController();
  const events = [];

  await runDaemon(
    {},
    {
      executeCycle: async () => {
        events.push('execute');
      },
      sleep: async (intervalMs) => {
        events.push(['sleep', intervalMs]);
        controller.abort();
      },
      signal: controller.signal,
    },
  );

  assert.deepEqual(events, ['execute', ['sleep', 60_000]]);
});

test('daemon never overlaps executor cycles', async () => {
  const controller = new AbortController();
  let active = 0;
  let maxActive = 0;
  let cycles = 0;
  let sleeps = 0;

  await runDaemon(
    {},
    {
      executeCycle: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        cycles += 1;
        active -= 1;
      },
      sleep: async (intervalMs) => {
        assert.equal(intervalMs, 60_000);
        sleeps += 1;
        if (sleeps === 2) controller.abort();
      },
      signal: controller.signal,
    },
  );

  assert.equal(cycles, 2);
  assert.equal(sleeps, 2);
  assert.equal(maxActive, 1);
});

test('daemon propagates an unexpected executor failure without sleeping or retrying in-process', async () => {
  const sentinel = new Error('sentinel executor failure');
  let sleeps = 0;

  await assert.rejects(
    () =>
      runDaemon(
        {},
        {
          executeCycle: async () => {
            throw sentinel;
          },
          sleep: async () => {
            sleeps += 1;
          },
        },
      ),
    (error) => error === sentinel,
  );

  assert.equal(sleeps, 0);
});
