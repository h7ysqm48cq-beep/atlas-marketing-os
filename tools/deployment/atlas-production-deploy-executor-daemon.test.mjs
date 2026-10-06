import assert from 'node:assert/strict';
import test from 'node:test';
import { runDaemon } from './atlas-production-deploy-executor-daemon.mjs';

function silentLogger() {
  return { log() {}, error() {} };
}

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
      heartbeatIntervalMs: 0,
      logger: silentLogger(),
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
      heartbeatIntervalMs: 0,
      logger: silentLogger(),
    },
  );

  assert.equal(cycles, 2);
  assert.equal(sleeps, 2);
  assert.equal(maxActive, 1);
});

test('daemon backs off repeated idle executor cycles to a two-minute cap', async () => {
  const controller = new AbortController();
  const sleeps = [];

  await runDaemon(
    {},
    {
      executeCycle: async () => ({
        results: [
          { service: 'engineering-runner', claim: { claimed: false } },
          { service: 'engineering-verifier', claim: { claimed: false } },
          { service: 'browser-worker', claim: { claimed: false } },
        ],
      }),
      sleep: async (intervalMs) => {
        sleeps.push(intervalMs);
        if (sleeps.length === 3) controller.abort();
      },
      signal: controller.signal,
      heartbeatIntervalMs: 0,
      logger: silentLogger(),
    },
  );

  assert.deepEqual(sleeps, [60_000, 120_000, 120_000]);
});

test('daemon resets idle backoff after any deployment dispatch is claimed', async () => {
  const controller = new AbortController();
  const sleeps = [];
  let cycles = 0;

  await runDaemon(
    {},
    {
      executeCycle: async () => {
        cycles += 1;
        const claimed = cycles === 3;
        return {
          results: [
            {
              service: 'engineering-runner',
              claim: { claimed },
            },
            { service: 'engineering-verifier', claim: { claimed: false } },
            { service: 'browser-worker', claim: { claimed: false } },
          ],
        };
      },
      sleep: async (intervalMs) => {
        sleeps.push(intervalMs);
        if (sleeps.length === 4) controller.abort();
      },
      signal: controller.signal,
      heartbeatIntervalMs: 0,
      logger: silentLogger(),
    },
  );

  assert.deepEqual(sleeps, [60_000, 120_000, 60_000, 60_000]);
});

test('daemon emits a structured completion heartbeat with exact cadence evidence', async () => {
  const controller = new AbortController();
  const logs = [];
  let nowMs = Date.parse('2026-10-06T15:30:00.000Z');

  await runDaemon(
    {},
    {
      executeCycle: async () => {
        nowMs += 250;
        return {
          sha: '5da1a3fd11032cb4aa436fb66f1c0142228f2eaf',
          results: [
            { service: 'engineering-runner', claim: { claimed: false } },
            { service: 'engineering-verifier', claim: { claimed: false } },
            { service: 'browser-worker', claim: { claimed: false } },
          ],
        };
      },
      sleep: async (intervalMs) => {
        assert.equal(intervalMs, 60_000);
        controller.abort();
      },
      signal: controller.signal,
      heartbeatIntervalMs: 0,
      now: () => nowMs,
      logger: {
        log(event, payload) {
          logs.push([event, payload]);
        },
      },
    },
  );

  assert.deepEqual(logs, [
    [
      'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT',
      {
        phase: 'cycle_start',
        cycle: 1,
        at: '2026-10-06T15:30:00.000Z',
        heartbeatIntervalMs: 0,
        cycleTimeoutMs: 1_500_000,
      },
    ],
    [
      'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT',
      {
        phase: 'cycle_complete',
        cycle: 1,
        at: '2026-10-06T15:30:00.250Z',
        sha: '5da1a3fd11032cb4aa436fb66f1c0142228f2eaf',
        claimedWork: false,
        cycleMs: 250,
        nextPollMs: 60_000,
      },
    ],
  ]);
});

test('daemon emits running heartbeats while a long executor cycle is still active', async () => {
  const controller = new AbortController();
  const logs = [];
  let intervalCallback;
  let cleared = false;
  let nowMs = Date.parse('2026-10-06T15:30:00.000Z');

  await runDaemon(
    {},
    {
      executeCycle: async () => {
        nowMs += 61_000;
        intervalCallback();
        return {
          sha: '5da1a3fd11032cb4aa436fb66f1c0142228f2eaf',
          results: [
            { service: 'engineering-runner', claim: { claimed: true } },
          ],
        };
      },
      sleep: async () => {
        controller.abort();
      },
      signal: controller.signal,
      now: () => nowMs,
      setIntervalFn: (callback, intervalMs) => {
        assert.equal(intervalMs, 60_000);
        intervalCallback = callback;
        return 'heartbeat-handle';
      },
      clearIntervalFn: (handle) => {
        assert.equal(handle, 'heartbeat-handle');
        cleared = true;
      },
      logger: {
        log(event, payload) {
          logs.push([event, payload]);
        },
      },
    },
  );

  const running = logs.find(
    ([event, payload]) =>
      event === 'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT' &&
      payload.phase === 'cycle_running',
  );

  assert.deepEqual(running, [
    'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT',
    {
      phase: 'cycle_running',
      cycle: 1,
      at: '2026-10-06T15:31:01.000Z',
      elapsedMs: 61_000,
      heartbeatIntervalMs: 60_000,
      cycleTimeoutMs: 1_500_000,
    },
  ]);
  assert.equal(cleared, true);
});

test('daemon fails closed when one executor cycle exceeds the watchdog timeout', async () => {
  const logs = [];
  let slept = false;
  let timeoutMsSeen = null;
  let timeoutCleared = false;

  await assert.rejects(
    () =>
      runDaemon(
        {},
        {
          executeCycle: async () => new Promise(() => {}),
          sleep: async () => {
            slept = true;
          },
          heartbeatIntervalMs: 0,
          cycleTimeoutMs: 5_000,
          setTimeoutFn: (callback, timeoutMs) => {
            timeoutMsSeen = timeoutMs;
            queueMicrotask(callback);
            return 'timeout-handle';
          },
          clearTimeoutFn: (handle) => {
            assert.equal(handle, 'timeout-handle');
            timeoutCleared = true;
          },
          logger: {
            log(event, payload) {
              logs.push([event, payload]);
            },
          },
        },
      ),
    /production deploy executor cycle exceeded 5000ms/,
  );

  assert.equal(timeoutMsSeen, 5_000);
  assert.equal(timeoutCleared, true);
  assert.equal(slept, false);
  assert.equal(
    logs.some(
      ([event, payload]) =>
        event === 'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_HEARTBEAT' &&
        payload.phase === 'cycle_failed',
    ),
    true,
  );
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
          heartbeatIntervalMs: 0,
          logger: silentLogger(),
        },
      ),
    (error) => error === sentinel,
  );

  assert.equal(sleeps, 0);
});
