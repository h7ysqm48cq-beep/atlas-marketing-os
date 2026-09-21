import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SupervisorCandidatePublicationReceipt, SupervisorReviewCandidate,
} from '../agent-supervisor.types';

/**
 * Read-only exact GitHub ref check. Persisted remoteVerified=true alone
 * is never authoritative external evidence. Credential stays server-side.
 */
export const ATLAS_CANDIDATE_REMOTE_FETCH = Symbol('ATLAS_CANDIDATE_REMOTE_FETCH');

export interface TrustedCandidatePublicationVerifier {
  assertPublished(input: {
    taskId: string; implementationId: string;
    candidate: SupervisorReviewCandidate;
    receipt: SupervisorCandidatePublicationReceipt;
  }): Promise<void>;
}
function deny(): never {
  throw new ForbiddenException('signed_candidate_remote_ref_unverified');
}
@Injectable()
export class GitHubCandidatePublicationVerifier
  implements TrustedCandidatePublicationVerifier {
  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(ATLAS_CANDIDATE_REMOTE_FETCH)
    private readonly request: typeof fetch = fetch,
  ) {}

  async assertPublished(input: {
    taskId: string; implementationId: string;
    candidate: SupervisorReviewCandidate;
    receipt: SupervisorCandidatePublicationReceipt;
  }): Promise<void> {
    try {
      const { taskId, implementationId, candidate, receipt } = input;
      const repo = this.config.get<string>(
        'ATLAS_SUPERVISOR_GITHUB_REPOSITORY');
      const token = this.config.get<string>(
        'ATLAS_SUPERVISOR_GITHUB_READ_TOKEN');
      if (!repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
          repo.split('/').some(segment =>
            segment === '.' || segment === '..') ||
          !taskId || !implementationId ||
          !/^[a-f0-9]{40}$/i.test(candidate.headSha) ||
          candidate.targetBranch !== 'production/atlas' ||
          receipt.remoteVerified !== true ||
          receipt.taskId !== taskId ||
          receipt.executionId !== implementationId ||
          receipt.targetBranch !== candidate.targetBranch ||
          receipt.baseSha !== candidate.baseSha ||
          receipt.headSha !== candidate.headSha ||
          receipt.remoteHeadSha !== candidate.headSha ||
          receipt.candidateBranch !==
            'atlas/candidate/' + taskId + '/' + implementationId ||
          receipt.changedFiles.length !== candidate.changedFiles.length ||
          [...receipt.changedFiles].sort().join('\u0000') !==
            [...candidate.changedFiles].sort().join('\u0000')) deny();

      const [owner, name] = repo.split('/');
      const branch = receipt.candidateBranch.split('/')
        .map(encodeURIComponent).join('/');
      const url = 'https://api.github.com/repos/' +
        encodeURIComponent(owner) + '/' + encodeURIComponent(name) +
        '/git/ref/heads/' + branch;
      const response = await this.request(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) deny();
      const remote = await response.json() as {
        ref?: unknown;
        object?: { type?: unknown; sha?: unknown };
      };
      if (!remote || remote.ref !==
          'refs/heads/' + receipt.candidateBranch ||
          remote.object?.type !== 'commit' ||
          remote.object.sha !== candidate.headSha) deny();
    } catch {
      deny();
    }
  }
}
