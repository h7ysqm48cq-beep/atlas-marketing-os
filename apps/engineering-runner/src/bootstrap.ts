import { CandidatePublisher } from './candidate-publisher.ts';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CandidateSourceRepository } from './candidate-source-repository.ts';
import { CandidateWorkspaceManager } from './candidate-workspace.ts';
import type { EngineeringRunnerConfig } from './config.ts';
import { CommandExecutor } from './executor.ts';
import type { EngineeringRunnerOptions } from './runner.ts';
import { ExactScopeGuard, GitWorkspace } from './scope-guard.ts';
import { SupervisorClient } from './supervisor-client.ts';

const TRUSTED_SUPERVISOR_EXECUTOR_PATH = fileURLToPath(
  new URL('../../../tools/ai_engineer/supervisor_executor.py', import.meta.url),
);

function candidateExecutorArgs(config: EngineeringRunnerConfig): string[] {
  const isConfiguredSupervisorModule =
    basename(config.command) === 'python3' &&
    config.args.length === 2 &&
    config.args[0] === '-m' &&
    config.args[1] === 'tools.ai_engineer.supervisor_executor';
  return isConfiguredSupervisorModule
    ? [TRUSTED_SUPERVISOR_EXECUTOR_PATH]
    : [...config.args];
}

export function createEngineeringRunnerOptions(
  config: EngineeringRunnerConfig,
  environment: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerOptions {
  const executionPurpose = config.executionPurpose ??
    (config.exactTarget ? 'INDEPENDENT_VERIFICATION' : 'IMPLEMENTATION');
  const base: EngineeringRunnerOptions = {
    client: new SupervisorClient({
      baseUrl: config.supervisorApiUrl,
      bootstrapToken: config.bootstrapToken,
      requireFrozenBaseSha:
        executionPurpose === 'IMPLEMENTATION' &&
        Boolean(config.candidate && !config.exactTarget),
      executionPurpose,
      ...(config.exactTarget ? {
        exactTarget: config.exactTarget,
      } : {}),
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
  const candidatePublisher =
    executionPurpose === 'INDEPENDENT_VERIFICATION'
      ? undefined
      : new CandidatePublisher({
          remote: config.candidate.remote,
          publisherToken: config.candidate.publisherToken,
          publisherSshPrivateKey: config.candidate.publisherSshPrivateKey,
          publisherSshPrivateKeyPath: config.candidate.publisherSshPrivateKeyPath,
          environment,
        });
  return {
    ...base,
    preflight: async () => {
      await candidateSource.refresh();
      await candidatePublisher?.prepare();
    },
    candidateWorkspaceManager: new CandidateWorkspaceManager({
      repositoryRoot: config.candidate.repositoryRoot,
      workspaceRoot: config.candidate.workspaceRoot,
      ensureBase: (frozenBaseSha) => candidateSource.ensureBase(frozenBaseSha),
      ensureCandidate: (baseSha, headSha) =>
        candidateSource.ensureExistingCandidate(baseSha, headSha),
      ensureProductionHead: (headSha) =>
        candidateSource.ensureProductionHead(headSha),
      ensureProductionAdvance: (baseSha, productionSha, paths, headSha) =>
        candidateSource.ensureProductionAdvance(
          baseSha, productionSha, paths, headSha,
        ),
    }),
    ...(candidatePublisher ? { candidatePublisher } : {}),
    singleShot: Boolean(config.exactTarget),
    executorFactory: (cwd: string) => new CommandExecutor({
      command: config.command,
      args: candidateExecutorArgs(config),
      cwd,
      environment,
    }),
  };
}
