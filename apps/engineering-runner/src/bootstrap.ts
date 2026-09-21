import { CandidatePublisher } from './candidate-publisher.ts';
import { CandidateSourceRepository } from './candidate-source-repository.ts';
import { CandidateWorkspaceManager } from './candidate-workspace.ts';
import type { EngineeringRunnerConfig } from './config.ts';
import { CommandExecutor } from './executor.ts';
import type { EngineeringRunnerOptions } from './runner.ts';
import { ExactScopeGuard, GitWorkspace } from './scope-guard.ts';
import { SupervisorClient } from './supervisor-client.ts';
import { SignedSupervisorClient } from './signed-supervisor-client.ts';

export function createEngineeringRunnerOptions(
  config: EngineeringRunnerConfig,
  environment: NodeJS.ProcessEnv = process.env,
): EngineeringRunnerOptions {
  const base: EngineeringRunnerOptions = {
    client: config.signed
      ? new SignedSupervisorClient({
        baseUrl: config.supervisorApiUrl,
        actorBootstrapToken: config.bootstrapToken,
        signingKid: config.signed.kid,
        signingPrivateKeyPem: config.signed.privateKeyPem,
        executionPurpose: config.signed.purpose,
      })
      : new SupervisorClient({
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
  if (config.signed?.purpose === 'INDEPENDENT_VERIFICATION') {
    const sourceConfig = config.verifierSource;
    if (!sourceConfig) {
      throw new Error('runner_signed_verifier_source_required');
    }
    const source = new CandidateSourceRepository({
      repositoryRoot: sourceConfig.repositoryRoot,
      remote: sourceConfig.remote,
      sourceToken: sourceConfig.sourceToken, environment,
    });
    const manager = new CandidateWorkspaceManager({
      repositoryRoot: sourceConfig.repositoryRoot,
      workspaceRoot: sourceConfig.workspaceRoot,
    });
    return {
      ...base,
      preflight: () => source.refresh(),
      verifierWorkspaceManager: {
        prepare: async input => {
          const names = input.candidateBranch.split('/');
          if (names.length !== 4 || names[0] !== 'atlas' ||
              names[1] !== 'candidate' || names[2] !== input.taskId) {
            throw new Error('verifier_candidate_ref_invalid');
          }
          await source.ensureCandidate({
            taskId: input.taskId, implementationId: names[3],
            candidateBranch: input.candidateBranch,
            baseSha: input.frozenBaseSha,
            headSha: input.candidateHeadSha,
          });
          return manager.prepare({
            taskId: input.taskId, executionId: input.executionId,
            frozenBaseSha: input.candidateHeadSha,
            allowedPaths: input.allowedPaths,
          });
        },
      },
      executorFactory: (cwd: string) => new CommandExecutor({
        command: config.command, args: config.args, cwd, environment,
      }),
    };
  }
  if (!config.candidate) return base;
  const candidateSource = new CandidateSourceRepository({
    repositoryRoot: config.candidate.repositoryRoot,
    remote: config.candidate.remote,
    sourceToken: config.candidate.sourceToken,
    environment,
  });
  const candidatePublisher = new CandidatePublisher({
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
      await candidatePublisher.prepare();
    },
    candidateWorkspaceManager: new CandidateWorkspaceManager({
      repositoryRoot: config.candidate.repositoryRoot,
      workspaceRoot: config.candidate.workspaceRoot,
      ensureBase: (frozenBaseSha) => candidateSource.ensureBase(frozenBaseSha),
    }),
    candidatePublisher,
    executorFactory: (cwd: string) => new CommandExecutor({
      command: config.command,
      args: config.args,
      cwd,
      environment,
    }),
  };
}
