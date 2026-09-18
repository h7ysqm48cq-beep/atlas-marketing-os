import { CandidatePublisher } from './candidate-publisher.ts';
import { CandidateSourceRepository } from './candidate-source-repository.ts';
import { CandidateWorkspaceManager } from './candidate-workspace.ts';
import type { EngineeringRunnerConfig } from './config.ts';
import { CommandExecutor } from './executor.ts';
import type { EngineeringRunnerOptions } from './runner.ts';
import { ExactScopeGuard, GitWorkspace } from './scope-guard.ts';
import { SupervisorClient } from './supervisor-client.ts';

export function createEngineeringRunnerOptions(
  config: EngineeringRunnerConfig,
  environment: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerOptions {
  const base: EngineeringRunnerOptions = {
    client: new SupervisorClient({
      baseUrl: config.supervisorApiUrl,
      bootstrapToken: config.bootstrapToken,
      requireFrozenBaseSha: Boolean(config.candidate),
    }),
    executor: new CommandExecutor({
      command: config.command, args: config.args,
      cwd: config.workspace, environment,
    }),
    workspace: new GitWorkspace(config.workspace, environment),
    scopeGuard: new ExactScopeGuard(),
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
  };
  if (!config.candidate) return base;
  const candidateSource = new CandidateSourceRepository({
    repositoryRoot: config.candidate.repositoryRoot,
    remote: config.candidate.remote,
    sourceToken: config.candidate.sourceToken,
    environment,
  });
  return {
    ...base,
    preflight: () => candidateSource.refresh(),
    candidateWorkspaceManager: new CandidateWorkspaceManager({
      repositoryRoot: config.candidate.repositoryRoot,
      workspaceRoot: config.candidate.workspaceRoot,
      ensureBase: (frozenBaseSha) => candidateSource.ensureBase(frozenBaseSha),
    }),
    candidatePublisher: new CandidatePublisher({
      remote: config.candidate.remote,
      publisherToken: config.candidate.publisherToken,
      publisherSshPrivateKey: config.candidate.publisherSshPrivateKey,
      environment,
    }),
    executorFactory: (cwd: string) => new CommandExecutor({
      command: config.command,
      args: config.args,
      cwd,
      environment,
    }),
  };
}
