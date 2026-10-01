import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execute } from './atlas-production-deploy-executor.mjs';

function defaultSleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function runDaemon(
  env = process.env,
  {
    executeCycle = execute,
    sleep = defaultSleep,
    intervalMs = 60_000,
    maxIdleIntervalMs = 120_000,
    logger = console,
    signal,
  } = {},
) {
  let nextIdleIntervalMs = intervalMs;

  while (!signal?.aborted) {
    const result = await executeCycle(env, { logger });
    const results = Array.isArray(result?.results) ? result.results : null;
    const hadClaimedWork =
      results === null ||
      results.some((entry) => entry?.claim?.claimed === true);

    const sleepMs = hadClaimedWork ? intervalMs : nextIdleIntervalMs;
    await sleep(sleepMs);

    nextIdleIntervalMs = hadClaimedWork
      ? intervalMs
      : Math.min(
          Math.max(intervalMs, maxIdleIntervalMs),
          Math.max(intervalMs, nextIdleIntervalMs * 2),
        );
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  runDaemon().catch((error) => {
    console.error(
      'ATLAS_PRODUCTION_DEPLOY_EXECUTOR_DAEMON_FAILED',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
