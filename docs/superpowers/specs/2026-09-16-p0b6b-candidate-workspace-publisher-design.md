# P0B-6B Candidate Workspace / Publisher Design

## Status

Approved architecture direction for P0B-6B. This spec defines the trust boundary between bounded engineering execution and Git candidate publication.

Base for this design: `production/atlas@64a85dc2fddb7fc05361e68450d5379293662d7e`.

## Problem

P0B-6A established a Supervisor-aware bounded executor, but implementation results still depend on a manually prepared workspace or replay. The executor can safely mutate exact allowed files, yet Atlas does not own the full provenance chain from frozen base SHA to a remotely verifiable candidate branch.

P0B-6B must make candidate creation reproducible without giving the AI executor merge, deploy, or unrestricted Git authority.

## Goals

- Create an isolated workspace from an exact frozen base SHA for one IMPLEMENTATION execution.
- Publish only the exact Git delta already verified against Supervisor scope.
- Derive candidate provenance from Git objects, not from executor-provided SHA claims.
- Push only a new candidate branch and verify its remote SHA.
- Produce a structured `CandidatePublicationReceipt` suitable for deriving a Supervisor `reviewCandidate`.
- Preserve existing Human Owner merge authorization and trusted GitHub merge-attestation gates.

## Non-goals

P0B-6B v1 does not:

- create or merge pull requests;
- deploy any service;
- mutate Railway configuration or variables;
- change database/schema state;
- authorize merge or deployment;
- grant the generic executor arbitrary shell or GitHub credentials;
- replace the existing Supervisor review/Owner authorization/CI attestation model.

Automatic PR creation is a later 6B-2 concern. Persistent worker capacity remains P0B-6C.

## Authority Model

The system separates five authorities:

1. **Supervisor** — defines objective, exact `allowedPaths`, forbidden actions, acceptance, and execution purpose.
2. **Generic Executor** — plans and applies bounded code changes inside the assigned workspace only.
3. **Engineering Runner** — owns claim/capability, heartbeat, exact-scope observation, and execution completion/failure.
4. **Candidate Publisher** — stages exact verified files, creates one candidate commit/branch, pushes it, and verifies the remote ref.
5. **Human Owner / CI gate** — authorizes and attests integration. Publisher never receives this authority.

## Candidate Workspace Lifecycle

For each IMPLEMENTATION execution, the workspace manager receives:

- `taskId`;
- `executionId`;
- `frozenBaseSha`;
- exact `allowedPaths`;
- repository root / remote identity.

It creates an isolated worktree or equivalent checkout at the exact `frozenBaseSha`. Before execution it must prove:

- `HEAD == frozenBaseSha`;
- working tree and index are clean;
- no active branch points at `production/atlas` from this workspace;
- all allowed paths are repository-relative, traversal-free, and do not resolve through symlinks outside the repository.

The workspace is execution-scoped. It must not be reused by another execution before explicit cleanup.

The workspace manager does not publish, merge, or deploy. Its only responsibility is deterministic isolation and cleanup.

## Execution-to-Publication Handoff

After the Generic Executor returns success, the Runner independently observes Git state. Publication is allowed only when the observed changed-file set exactly equals the implementation evidence `changedFiles` and is a subset of assignment `allowedPaths`.

If any of these checks fail, publication is skipped and the execution fails closed.

The executor cannot supply `baseSha`, `headSha`, candidate branch, or remote verification as authoritative values. Those values are owned by the workspace manager / publisher and re-derived from Git.

## Candidate Publisher Contract

The Publisher input is a narrow immutable request:

```ts
interface CandidatePublicationRequest {
  taskId: string;
  executionId: string;
  workspace: string;
  frozenBaseSha: string;
  targetBranch: 'production/atlas';
  changedFiles: string[];
}
```

The publisher must reject verification executions and any target branch other than the fixed integration target represented in the receipt. It never writes that integration branch.

The candidate branch name is deterministic and derived internally, never accepted from the caller:

`atlas/candidate/<taskId>/<executionId>`

The remote branch must not already exist. V1 has no update, retry-push, force-push, or branch-reuse semantics.

## Publication Algorithm

Publisher performs the following sequence and aborts on the first mismatch:

1. Re-read `HEAD` and require `HEAD == frozenBaseSha` before commit.
2. Re-read working tree and index; require zero pre-existing staged changes.
3. Recompute changed files from Git.
4. Require recomputed files exactly equal the verified `changedFiles` set.
5. Stage with pathspec-safe exact paths only: `git add -- <verified paths>`.
6. Re-read staged file names and require exact equality with `changedFiles`.
7. Create one commit with an internally derived fixed-format message from `taskId`/`executionId`; callers cannot supply the commit message, and Git is invoked without shell interpolation.
8. Require the new commit has exactly one parent and that parent equals `frozenBaseSha`.
9. Recompute `git diff --name-only frozenBaseSha..candidateHead` and require exact equality.
10. Refuse if the remote candidate branch already exists.
11. Push only `candidateHead` to the deterministic candidate branch without force.
12. Fetch/read the remote ref and require `remoteHeadSha == candidateHead`.
13. Return the publication receipt.

If commit succeeds but push fails, the local candidate commit may remain for diagnostics, but the result is not publishable and `remoteVerified=false`; the execution must not complete as a review candidate.

## CandidatePublicationReceipt

```ts
interface CandidatePublicationReceipt {
  taskId: string;
  executionId: string;
  candidateBranch: string;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  targetBranch: 'production/atlas';
  remoteHeadSha: string;
  remoteVerified: true;
}
```

The Runner derives the Supervisor merge review candidate only from a valid receipt:

```ts
reviewCandidate = {
  action: 'merge',
  targetBranch: receipt.targetBranch,
  baseSha: receipt.baseSha,
  headSha: receipt.headSha,
  changedFiles: receipt.changedFiles,
};
```

Executor-provided `reviewCandidate` data is ignored for publication provenance.

## Credential Isolation

The Generic Executor child environment must continue stripping Supervisor bootstrap, execution capability, Owner, CI, merge, deployment, and publisher credentials.

The Publisher receives only the minimum Git publication credential through a separate invocation boundary. That credential must not grant merge, deployment, Railway, database, or social-platform authority.

Publisher code must never print the credential, embed it in a remote URL persisted to `.git/config`, or include it in execution evidence.

Authentication must be supplied ephemerally to the Git transport. The exact mechanism is implementation-specific, but persisted credential-bearing remotes are forbidden.

## Runner Integration

P0B-6B v1 adds publication after the existing implementation scope check and before `session.complete()`.

Conceptually:

```text
claim-next
→ executor
→ observe workspace
→ exact scope/evidence equality
→ publish candidate
→ derive reviewCandidate from receipt
→ complete execution
```

Independent verification keeps its current semantics: it must observe zero Git drift and never invokes the Publisher.

A publication failure is an execution failure, not a successful implementation with a warning. The Runner calls the normal failure endpoint and does not complete evidence containing a merge review candidate.

## Failure and Cleanup Semantics

Workspace creation failure, base mismatch, dirty-state detection, scope mismatch, staging mismatch, commit-parent mismatch, remote-branch collision, push failure, or remote-SHA mismatch all fail closed.

No failure path may mutate `production/atlas`, delete remote branches, force-update refs, or invoke merge/deploy APIs.

Local workspace cleanup is best-effort after the execution reaches a terminal state. Cleanup failure is observable operational debt but must not change a correctly recorded execution result.

## Proposed Module Boundaries

Implementation should remain inside the Engineering Runner package unless a later requirement proves a separate service is necessary.

Expected first-pass files:

- `apps/engineering-runner/src/candidate-workspace.ts`
- `apps/engineering-runner/src/candidate-workspace.spec.ts`
- `apps/engineering-runner/src/candidate-publisher.ts`
- `apps/engineering-runner/src/candidate-publisher.spec.ts`
- minimal wiring changes in `apps/engineering-runner/src/runner.ts`
- corresponding runner regression tests

No API persistence or schema change is required for v1. The publication receipt travels inside normal execution evidence.

The legacy `apps/api/src/engineering/git/git.commit.service.ts` is explicitly out of scope and must not be used as the publication authority.

## Test Strategy

Use TDD. All publication tests run against temporary local Git repositories with a local bare repository acting as the remote, so no real GitHub writes are required during unit tests.

The existing Engineering Runner 19-test baseline and P0B-6A Supervisor executor 13-test baseline must remain green.

Required tests include:

1. exact clean frozen base creates an isolated workspace;
2. wrong base SHA is rejected;
3. dirty starting workspace is rejected;
4. exact allowed change stages only exact paths;
5. extra tracked change blocks publication;
6. extra untracked change blocks publication;
7. symlink escape blocks publication;
8. staged-file mismatch blocks commit;
9. candidate commit parent must equal frozen base;
10. existing remote candidate branch is rejected;
11. force-push behavior is absent and cannot be requested;
12. `production/atlas` cannot be used as the pushed ref;
13. remote SHA mismatch blocks a receipt;
14. verification execution never invokes Publisher;
15. executor environment never contains publisher credentials;
16. successful publication returns an exact, remote-verified receipt;
17. Runner derives `reviewCandidate` from the receipt rather than executor-provided SHA data;
18. publication failure calls normal execution failure and never completion.

## Rollout

V1 is merged as code only and exercised first against local/bare remotes in tests and an isolated non-production smoke. It does not create a Railway service or change production runtime configuration.

Production-host credential provisioning and persistent capacity belong to P0B-6C and require their own deployment-governance review.

## Acceptance Criteria

P0B-6B v1 is complete when:

- an IMPLEMENTATION execution can begin from a frozen base in an isolated workspace;
- bounded execution changes only exact Supervisor-allowed paths;
- the Runner independently confirms scope before publication;
- the Publisher creates exactly one commit whose parent is the frozen base;
- only a new deterministic candidate branch can be pushed;
- remote ref verification proves the published head SHA;
- the resulting review candidate is derived only from the publication receipt;
- verifier executions remain read-only and publication-free;
- no merge, deployment, DB, Railway, or Human Owner authority is added;
- existing Supervisor/Owner/CI merge gates remain unchanged.

## Deferred Work

P0B-6B-2 may add automatic PR creation and exact Supervisor metadata attachment after v1 publication provenance is proven.

P0B-6C will address persistent worker capacity, production-host credential provisioning, singleton/lifecycle behavior, and deployment governance for the Engineering Runner service.

These phases must not be pulled into the P0B-6B v1 implementation scope.
