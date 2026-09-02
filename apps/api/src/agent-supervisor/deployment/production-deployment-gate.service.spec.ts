type ProductionService = 'api' | 'web' | 'browser-worker';
type DriftStatus =
  'COMPLIANT' | 'BRANCH_DRIFT' | 'SHA_DRIFT' | 'MISSING_PROVENANCE';

interface GithubDeploymentProvenance {
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  commitSha?: string;
}

interface ProductionDeploymentInput {
  service: ProductionService;
  supervisorApprovedSha: string;
  github?: GithubDeploymentProvenance;
}

interface ProductionDeploymentGateContract {
  assertProductionDeployment(input: ProductionDeploymentInput): {
    allowed: true;
    reason: null;
  };
  evaluateDrift(input: ProductionDeploymentInput): DriftStatus;
}

type GateConstructor = new () => ProductionDeploymentGateContract;

const APPROVED_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const CANONICAL_GITHUB: GithubDeploymentProvenance = {
  repositoryOwner: 'h7ysqm48cq-beep',
  repositoryName: 'atlas-marketing-os',
  branch: 'production/atlas',
  commitSha: APPROVED_SHA,
};

function input(
  overrides: Partial<ProductionDeploymentInput> = {},
): ProductionDeploymentInput {
  return {
    service: 'api',
    supervisorApprovedSha: APPROVED_SHA,
    github: CANONICAL_GITHUB,
    ...overrides,
  };
}

function gate(): ProductionDeploymentGateContract {
  let Constructor: GateConstructor | undefined;
  try {
    Constructor = (
      jest.requireActual('./production-deployment-gate.service') as {
        ProductionDeploymentGateService?: GateConstructor;
      }
    ).ProductionDeploymentGateService;
  } catch (error) {
    if ((error as { code?: string }).code !== 'MODULE_NOT_FOUND') throw error;
  }
  expect(Constructor).toBeDefined();
  return new (Constructor as GateConstructor)();
}

function thrownBy(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('ProductionDeploymentGateService', () => {
  it('rejects an unsupported production service', () => {
    expect(
      thrownBy(() =>
        gate().assertProductionDeployment(
          input({ service: 'datadog' as ProductionService }),
        ),
      ),
    ).toMatchObject({ response: { code: 'unsupported_production_service' } });
  });

  it.each([
    [{ repositoryOwner: 'someone-else' }, 'canonical_repository_required'],
    [{ repositoryName: 'another-repo' }, 'canonical_repository_required'],
  ])('rejects a non-canonical repository', (githubOverride, code) => {
    expect(
      thrownBy(() =>
        gate().assertProductionDeployment(
          input({ github: { ...CANONICAL_GITHUB, ...githubOverride } }),
        ),
      ),
    ).toMatchObject({ response: { code } });
  });

  it('rejects a production source branch other than production/atlas', () => {
    expect(
      thrownBy(() =>
        gate().assertProductionDeployment(
          input({ github: { ...CANONICAL_GITHUB, branch: 'main' } }),
        ),
      ),
    ).toMatchObject({
      response: { code: 'canonical_production_branch_required' },
    });
  });

  it('rejects a missing Git commit SHA', () => {
    expect(
      thrownBy(() =>
        gate().assertProductionDeployment(
          input({ github: { ...CANONICAL_GITHUB, commitSha: undefined } }),
        ),
      ),
    ).toMatchObject({ response: { code: 'git_commit_sha_required' } });
  });

  it.each(['a'.repeat(39), 'g'.repeat(40)])(
    'rejects malformed Git SHA %p',
    (commitSha) => {
      expect(
        thrownBy(() =>
          gate().assertProductionDeployment(
            input({ github: { ...CANONICAL_GITHUB, commitSha } }),
          ),
        ),
      ).toMatchObject({ response: { code: 'invalid_git_commit_sha' } });
    },
  );

  it('rejects a deployed SHA that differs from the Supervisor-approved SHA', () => {
    expect(
      thrownBy(() =>
        gate().assertProductionDeployment(
          input({ github: { ...CANONICAL_GITHUB, commitSha: OTHER_SHA } }),
        ),
      ),
    ).toMatchObject({
      response: { code: 'supervisor_approved_sha_mismatch' },
    });
  });

  it('rejects local or CLI snapshot deployment without GitHub provenance', () => {
    expect(
      thrownBy(() =>
        gate().assertProductionDeployment(input({ github: undefined })),
      ),
    ).toMatchObject({ response: { code: 'github_provenance_required' } });
  });

  it.each<ProductionService>(['api', 'web', 'browser-worker'])(
    'allows a canonical %s deployment only at the exact approved SHA',
    (service) => {
      expect(gate().assertProductionDeployment(input({ service }))).toEqual({
        allowed: true,
        reason: null,
      });
    },
  );

  it.each([
    ['COMPLIANT', input()],
    [
      'BRANCH_DRIFT',
      input({ github: { ...CANONICAL_GITHUB, branch: 'main' } }),
    ],
    [
      'SHA_DRIFT',
      input({ github: { ...CANONICAL_GITHUB, commitSha: OTHER_SHA } }),
    ],
    ['MISSING_PROVENANCE', input({ github: undefined })],
  ] as const)('distinguishes %s', (status, deployment) => {
    expect(gate().evaluateDrift(deployment)).toBe(status);
  });
});
