import { CommandExecutor } from './executor.ts';
import { loadEngineeringRunnerConfig } from './config.ts';
import { EngineeringRunner } from './runner.ts';
import { ExactScopeGuard } from './scope-guard.ts';
import { SupervisorClient } from './supervisor-client.ts';
import { GitWorkspace } from './workspace.ts';

async function main(): Promise<void> {
  const config = loadEngineeringRunnerConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const runner = new EngineeringRunner({
    client: new SupervisorClient({
      baseUrl: config.supervisorApiUrl,
      bootstrapToken: config.bootstrapToken,
    }),
    executor: new CommandExecutor({
      command: config.command,
      args: config.args,
      cwd: config.workspace,
      environment: process.env,
    }),
    workspace: new GitWorkspace(config.workspace),
    scopeGuard: new ExactScopeGuard(),
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
  });

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
