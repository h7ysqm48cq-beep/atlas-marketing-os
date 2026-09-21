import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  GitHubCandidatePublicationVerifier,
} from './github-candidate-publication-verifier';

const taskId = 'TASK-140';
const implementationId = 'EXEC-140';
const head = 'b'.repeat(40);
const candidate = {
  action: 'merge' as const, targetBranch: 'production/atlas',
  baseSha: 'a'.repeat(40), headSha: head,
  changedFiles: ['apps/api/src/a.ts'],
};
const receipt = {
  taskId, executionId: implementationId,
  candidateBranch: 'atlas/candidate/' + taskId + '/' + implementationId,
  baseSha: candidate.baseSha, headSha: head,
  changedFiles: ['apps/api/src/a.ts'],
  targetBranch: 'production/atlas' as const,
  remoteHeadSha: head, remoteVerified: true as const,
};
const expectedRef = 'refs/heads/' + receipt.candidateBranch;
const input = { taskId, implementationId, candidate, receipt };
function setup(options: {
  repo?: string | null; token?: string | null;
  ref?: string; sha?: string; type?: string; ok?: boolean;
  failure?: boolean;
} = {}) {
  const config = { get: (key: string) => {
    if (key === 'ATLAS_SUPERVISOR_GITHUB_REPOSITORY') {
      return options.repo === undefined ?
        'h7ysqm48cq-beep/atlas-marketing-os' : options.repo;
    }
    if (key === 'ATLAS_SUPERVISOR_GITHUB_READ_TOKEN') {
      return options.token === undefined ? 'TEST_TOKEN_NOT_REAL' : options.token;
    }
    return undefined;
  } } as ConfigService;
  const request = jest.fn().mockImplementation(async () => {
    if (options.failure) throw new Error('unreachable');
    return {
      ok: options.ok ?? true,
      json: async () => ({
        ref: options.ref ?? expectedRef,
        object: { type: options.type ?? 'commit',
          sha: options.sha ?? head },
      }),
    };
  });
  return {
    verifier: new GitHubCandidatePublicationVerifier(
      config, request as unknown as typeof fetch),
    request,
  };
}
describe('Issue #140 live candidate GitHub ref provenance (mocked HTTPS only)', () => {
  it('Nest container resolves verifier without an injected HTTP function provider', async () => {
    const module = await Test.createTestingModule({
      providers: [
        GitHubCandidatePublicationVerifier,
        { provide: ConfigService, useValue: {
          get: () => undefined,
        } },
      ],
    }).compile();
    expect(module.get(GitHubCandidatePublicationVerifier))
      .toBeInstanceOf(GitHubCandidatePublicationVerifier);
    await module.close();
  });
  it('checks exact branch and head through fixed GitHub API with no redirects', async () => {
    const { verifier, request } = setup();
    await expect(verifier.assertPublished(input)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/h7ysqm48cq-beep/' +
      'atlas-marketing-os/git/ref/heads/atlas/candidate/TASK-140/EXEC-140');
    expect(options.redirect).toBe('error');
    expect(options.cache).toBe('no-store');
    expect(options.headers.Authorization).toBe('Bearer TEST_TOKEN_NOT_REAL');
    expect(options.signal).toBeDefined();
  });
  it('no configured repo or read token: deny without network', async () => {
    for (const missing of [
      { repo: null }, { token: null }, { repo: 'evil.invalid' },
    ]) {
      const { verifier, request } = setup(missing);
      await expect(verifier.assertPublished(input))
        .rejects.toThrow('signed_candidate_remote_ref_unverified');
      expect(request).not.toHaveBeenCalled();
    }
  });
  it('rejects misleading remoteVerified boolean / wrong candidate branch', async () => {
    for (const changed of [
      { remoteVerified: false },
      { candidateBranch: 'atlas/candidate/something-else' },
      { remoteHeadSha: 'c'.repeat(40) },
    ]) {
      const { verifier, request } = setup();
      await expect(verifier.assertPublished({ ...input,
        receipt: { ...receipt, ...changed } as never,
      })).rejects.toThrow('signed_candidate_remote_ref_unverified');
      expect(request).not.toHaveBeenCalled();
    }
  });
  it('rejects wrong actual remote SHA, ref and non-commit refs', async () => {
    for (const changed of [
      { sha: 'c'.repeat(40) }, { ref: 'refs/heads/other' },
      { type: 'tag' },
    ]) {
      const { verifier } = setup(changed);
      await expect(verifier.assertPublished(input))
        .rejects.toThrow('signed_candidate_remote_ref_unverified');
    }
  });
  it('rejects unavailability/403/404, without accepting stored receipt', async () => {
    for (const changed of [
      { ok: false }, { failure: true },
    ]) {
      const { verifier } = setup(changed);
      await expect(verifier.assertPublished(input))
        .rejects.toThrow('signed_candidate_remote_ref_unverified');
    }
  });
});
