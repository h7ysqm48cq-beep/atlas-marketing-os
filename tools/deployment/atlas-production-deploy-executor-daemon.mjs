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
    logger = console,
    signal,
  } = {},
) {
  while (!signal?.aborted) {
    await executeCycle(env, { logger });
    await sleep(intervalMs);
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
