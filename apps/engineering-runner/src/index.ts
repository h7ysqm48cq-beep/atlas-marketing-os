import { createEngineeringRunnerOptions } from './bootstrap.ts';
import { loadEngineeringRunnerConfig } from './config.ts';
import { EngineeringRunner } from './runner.ts';

async function main(): Promise<void> {
  const config = loadEngineeringRunnerConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const runner = new EngineeringRunner(
    createEngineeringRunnerOptions(config, process.env),
  );

  try {
    await runner.run(controller.signal);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`engineering_runner_failed:${message}`);
  process.exitCode = 1;
});
