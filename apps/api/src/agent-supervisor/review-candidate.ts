import { BadRequestException } from '@nestjs/common';

import type {
  SupervisorReviewCandidate,
} from './agent-supervisor.types';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

function requireSha(
  value: string,
  code: string,
) {
  if (!FULL_GIT_SHA.test(value ?? '')) {
    throw new BadRequestException({ code });
  }

  return value.toLowerCase();
}

function normalizeRepoPath(path: string) {
  const normalized =
    path?.trim().replace(/\\/g, '/');

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new BadRequestException({
      code: 'invalid_repo_path',
    });
  }

  const segments = normalized.split('/');

  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..',
    )
  ) {
    throw new BadRequestException({
      code: 'invalid_repo_path',
    });
  }

  return normalized;
}

export function normalizeSupervisorReviewCandidate(
  candidate: SupervisorReviewCandidate,
): SupervisorReviewCandidate {
  const targetBranch =
    candidate.targetBranch?.trim();

  if (
    !targetBranch ||
    !Array.isArray(candidate.changedFiles)
  ) {
    throw new BadRequestException({
      code: 'review_candidate_incomplete',
    });
  }

  const baseSha = requireSha(
    candidate.baseSha,
    'invalid_base_sha',
  );
  const headSha = requireSha(
    candidate.headSha,
    'invalid_head_sha',
  );
  const changedFiles = Array.from(
    new Set(
      candidate.changedFiles.map(
        normalizeRepoPath,
      ),
    ),
  ).sort();

  const isRuntimeRefresh =
    candidate.action === 'deploy_production' &&
    targetBranch === 'production/atlas' &&
    baseSha === headSha &&
    changedFiles.length === 0;

  if (
    changedFiles.length === 0 &&
    !isRuntimeRefresh
  ) {
    throw new BadRequestException({
      code: 'review_candidate_empty_changes',
    });
  }

  return {
    action: candidate.action,
    targetBranch,
    baseSha,
    headSha,
    changedFiles,
  };
}
