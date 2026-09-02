import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ProductionDeploymentDriftStatus,
  ProductionDeploymentService,
  ProductionDeploymentValidationInput,
} from '../agent-supervisor.types';

const CANONICAL_REPOSITORY_OWNER = 'h7ysqm48cq-beep';
const CANONICAL_REPOSITORY_NAME = 'atlas-marketing-os';
const CANONICAL_PRODUCTION_BRANCH = 'production/atlas';
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const PRODUCTION_SERVICES = new Set<ProductionDeploymentService>([
  'api',
  'web',
  'browser-worker',
]);

@Injectable()
export class ProductionDeploymentGateService {
  assertProductionDeployment(input: ProductionDeploymentValidationInput) {
    if (!PRODUCTION_SERVICES.has(input.service)) {
      throw new BadRequestException({
        code: 'unsupported_production_service',
      });
    }
    const github = input.github;
    if (!github) {
      throw new BadRequestException({ code: 'github_provenance_required' });
    }
    if (
      github.repositoryOwner !== CANONICAL_REPOSITORY_OWNER ||
      github.repositoryName !== CANONICAL_REPOSITORY_NAME
    ) {
      throw new BadRequestException({ code: 'canonical_repository_required' });
    }
    if (github.branch !== CANONICAL_PRODUCTION_BRANCH) {
      throw new BadRequestException({
        code: 'canonical_production_branch_required',
      });
    }
    if (!github.commitSha) {
      throw new BadRequestException({ code: 'git_commit_sha_required' });
    }
    if (!FULL_GIT_SHA.test(github.commitSha)) {
      throw new BadRequestException({ code: 'invalid_git_commit_sha' });
    }
    if (!FULL_GIT_SHA.test(input.supervisorApprovedSha)) {
      throw new BadRequestException({
        code: 'invalid_supervisor_approved_sha',
      });
    }
    if (github.commitSha !== input.supervisorApprovedSha) {
      throw new BadRequestException({
        code: 'supervisor_approved_sha_mismatch',
      });
    }

    return { allowed: true, reason: null } as const;
  }

  evaluateDrift(
    input: ProductionDeploymentValidationInput,
  ): ProductionDeploymentDriftStatus {
    if (!PRODUCTION_SERVICES.has(input.service)) {
      return 'MISSING_PROVENANCE';
    }
    const github = input.github;
    if (
      !github?.repositoryOwner ||
      !github.repositoryName ||
      !github.branch ||
      !github.commitSha ||
      github.repositoryOwner !== CANONICAL_REPOSITORY_OWNER ||
      github.repositoryName !== CANONICAL_REPOSITORY_NAME
    ) {
      return 'MISSING_PROVENANCE';
    }
    if (github.branch !== CANONICAL_PRODUCTION_BRANCH) {
      return 'BRANCH_DRIFT';
    }
    if (
      !FULL_GIT_SHA.test(github.commitSha) ||
      !FULL_GIT_SHA.test(input.supervisorApprovedSha) ||
      github.commitSha !== input.supervisorApprovedSha
    ) {
      return 'SHA_DRIFT';
    }
    return 'COMPLIANT';
  }
}
