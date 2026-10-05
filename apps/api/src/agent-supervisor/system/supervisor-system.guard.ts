import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  AuthorityClaims,
  AuthorityPurpose,
} from '../authority/authority.types';
import {
  SupervisorAuthorityService,
  canonicalizeAuthorityValue,
} from '../authority/supervisor-authority.service';
import type {
  CreateSupervisorTaskInput,
  SupervisorMergeTargetBranch,
} from '../agent-supervisor.types';

export const SUPERVISOR_SYSTEM_PURPOSE =
  'atlas-supervisor-system-purpose';
export const SUPERVISOR_SYSTEM_AUDIENCE =
  'atlas:supervisor.gateway';

export const SupervisorSystemPurposeRequired = (
  purpose: AuthorityPurpose,
) => SetMetadata(SUPERVISOR_SYSTEM_PURPOSE, purpose);

export interface SupervisorSystemAdmissionRequest {
  admissionId: string;
  task: CreateSupervisorTaskInput;
  frozenBaseSha?: string;
}

export interface SupervisorSystemVerificationAdmissionRequest {
  admissionId: string;
  task: CreateSupervisorTaskInput;
  candidateBaseSha: string;
  candidateHeadSha: string;
  productionBaselineSha: string;
  targetBranch?: SupervisorMergeTargetBranch;
  changedPaths: string[];
}

export interface SupervisorSystemAuthorizationContext {
  claims: AuthorityClaims;
}

export function supervisorSystemAdmissionDigest(
  input: SupervisorSystemAdmissionRequest,
): string {
  const normalized = {
    admissionId: input.admissionId?.trim().toLowerCase(),
    task: input.task,
    frozenBaseSha:
      input.frozenBaseSha?.trim().toLowerCase() || undefined,
  };
  return createHash('sha256')
    .update(canonicalizeAuthorityValue(normalized), 'utf8')
    .digest('hex');
}

export function supervisorSystemVerificationAdmissionDigest(
  input: SupervisorSystemVerificationAdmissionRequest,
): string {
  const normalized = {
    admissionId: input.admissionId?.trim().toLowerCase(),
    task: input.task,
    candidateBaseSha:
      input.candidateBaseSha?.trim().toLowerCase(),
    candidateHeadSha:
      input.candidateHeadSha?.trim().toLowerCase(),
    productionBaselineSha:
      input.productionBaselineSha?.trim().toLowerCase(),
    targetBranch:
      input.targetBranch ?? 'production/atlas',
    changedPaths: input.changedPaths,
  };
  return createHash('sha256')
    .update(canonicalizeAuthorityValue(normalized), 'utf8')
    .digest('hex');
}

@Injectable()
export class SupervisorSystemGuard implements CanActivate {
  constructor(
    private readonly authority: SupervisorAuthorityService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const purpose =
      this.reflector.getAllAndOverride<AuthorityPurpose>(
        SUPERVISOR_SYSTEM_PURPOSE,
        [context.getHandler(), context.getClass()],
      );
    if (!purpose) {
      throw new ForbiddenException(
        'supervisor_system_purpose_not_declared',
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers?: {
        authorization?: string | string[];
      };
      body?:
        | SupervisorSystemAdmissionRequest
        | SupervisorSystemVerificationAdmissionRequest;
      supervisorSystemAuthorization?:
        SupervisorSystemAuthorizationContext;
    }>();
    const authorization = request.headers?.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ') ||
      authorization.length === 'Bearer '.length
    ) {
      throw new UnauthorizedException(
        'supervisor_system_assertion_required',
      );
    }

    const claims = this.authority.verify(
      authorization.slice('Bearer '.length),
      {
        domain: 'SUPERVISOR_SYSTEM',
        audience: SUPERVISOR_SYSTEM_AUDIENCE,
        actorType: 'EXECUTIVE_SUPERVISOR',
        tokenType: 'SYSTEM_ASSERTION',
        purpose,
        claimEpoch: 0,
      },
    );

    if (
      purpose === 'ADMISSION' ||
      purpose === 'VERIFICATION_COORDINATION'
    ) {
      const body = request.body;
      const admissionId =
        body?.admissionId?.trim().toLowerCase() ?? '';
      if (!admissionId || claims.admissionId !== admissionId) {
        throw new ForbiddenException(
          'supervisor_system_admission_id_mismatch',
        );
      }

      const digest =
        !body
          ? ''
          : purpose === 'ADMISSION'
            ? supervisorSystemAdmissionDigest(
                body as SupervisorSystemAdmissionRequest,
              )
            : supervisorSystemVerificationAdmissionDigest(
                body as SupervisorSystemVerificationAdmissionRequest,
              );

      if (
        typeof claims.admissionDigest !== 'string' ||
        claims.admissionDigest !== digest
      ) {
        throw new ForbiddenException(
          'supervisor_system_admission_digest_mismatch',
        );
      }
    }

    request.supervisorSystemAuthorization = { claims };
    return true;
  }
}
