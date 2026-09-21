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
import type { CreateSupervisorTaskInput } from '../agent-supervisor.types';

export const SUPERVISOR_SYSTEM_PURPOSE =
  'atlas-supervisor-system-purpose';
export const SUPERVISOR_SYSTEM_AUDIENCE =
  'atlas:supervisor.gateway';
export const SUPERVISOR_SYSTEM_REQUEST_BINDING =
  'atlas-supervisor-system-request-binding';
export type SupervisorSystemCoordinationAction = 'SIGNED_ADVANCE' | 'SIGNED_READY';
export const SupervisorSystemRequestBindingRequired = (
  action: SupervisorSystemCoordinationAction,
) => SetMetadata(SUPERVISOR_SYSTEM_REQUEST_BINDING, action);

export const SupervisorSystemPurposeRequired = (
  purpose: AuthorityPurpose,
) => SetMetadata(SUPERVISOR_SYSTEM_PURPOSE, purpose);

export interface SupervisorSystemAdmissionRequest {
  admissionId: string;
  task: CreateSupervisorTaskInput;
  frozenBaseSha?: string;
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

/** Bind one short-lived system assertion to EXACT coordination operation+body. */
export function supervisorSystemCoordinationDigest(input: {
  taskId: string; expectedTaskVersion?: string;
}, action: SupervisorSystemCoordinationAction): string {
  const canonicalInput = action === 'SIGNED_ADVANCE'
    ? { action, taskId: input.taskId }
    : { action, taskId: input.taskId,
        expectedTaskVersion: input.expectedTaskVersion };
  return createHash('sha256').update(
    canonicalizeAuthorityValue(canonicalInput), 'utf8',
  ).digest('hex');
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
      body?: SupervisorSystemAdmissionRequest & {
        taskId?: string; expectedTaskVersion?: string;
      };
      supervisorSystemAuthorization?: SupervisorSystemAuthorizationContext;
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

    if (purpose === 'ADMISSION') {
      const body = request.body;
      const admissionId =
        body?.admissionId?.trim().toLowerCase() ?? '';
      if (!admissionId || claims.admissionId !== admissionId) {
        throw new ForbiddenException(
          'supervisor_system_admission_id_mismatch',
        );
      }
      const digest =
        body
          ? supervisorSystemAdmissionDigest(body)
          : '';
      if (
        typeof claims.admissionDigest !== 'string' ||
        claims.admissionDigest !== digest
      ) {
        throw new ForbiddenException(
          'supervisor_system_admission_digest_mismatch',
        );
      }
    }

    const action = purpose === 'VERIFICATION_COORDINATION'
      ? this.reflector.getAllAndOverride<
          SupervisorSystemCoordinationAction>(
          SUPERVISOR_SYSTEM_REQUEST_BINDING,
          [context.getHandler(), context.getClass()],
        ) : undefined;
    if (action !== undefined) {
      if (purpose !== 'VERIFICATION_COORDINATION' ||
          (action !== 'SIGNED_ADVANCE' && action !== 'SIGNED_READY')) {
        throw new ForbiddenException('supervisor_system_coordination_purpose_invalid');
      }
      const body = request.body;
      const taskId = body?.taskId;
      const expectedTaskVersion = body?.expectedTaskVersion;
      if (typeof taskId !== 'string' || !taskId.trim() ||
          (action === 'SIGNED_READY' &&
            (typeof expectedTaskVersion !== 'string' ||
             !Number.isFinite(Date.parse(expectedTaskVersion)) ||
             !expectedTaskVersion.endsWith('Z'))) ||
          claims.taskId !== taskId ||
          claims.coordinationDigest !== supervisorSystemCoordinationDigest({
            taskId, ...(action === 'SIGNED_READY'
              ? { expectedTaskVersion } : {}),
          }, action)) {
        throw new ForbiddenException('supervisor_system_coordination_binding_mismatch');
      }
    }

    request.supervisorSystemAuthorization = { claims };
    return true;
  }
}
