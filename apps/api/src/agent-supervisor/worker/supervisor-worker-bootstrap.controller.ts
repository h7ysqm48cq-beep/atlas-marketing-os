import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import type {
  SupervisorExecution,
  SupervisorExecutionPurpose,
} from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_CLAIM_STORE,
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionClaimStore,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';
import { VerifierCapabilityService } from '../authority/verifier-capability.service';
import { SupervisorWorkerCapabilityService } from './supervisor-worker-capability.service';
import { SupervisorWorkerBootstrapGuard } from './supervisor-worker-bootstrap.guard';
import type { AuthenticatedBootstrapActor } from './supervisor-bootstrap-actor-registry';

const INITIAL_CLAIM_LEASE_MS = 60_000;

type BootstrapRequest = Request & {
  supervisorWorkerBootstrapRole?: SupervisorExecution['workerRole'];
  supervisorAuthenticatedActor?: AuthenticatedBootstrapActor;
};

@Public()
@UseGuards(SupervisorWorkerBootstrapGuard)
@Controller('engineering/supervisor/worker')
export class SupervisorWorkerBootstrapController {
  constructor(
    @Inject(SUPERVISOR_EXECUTION_CLAIM_STORE)
    private readonly claimStore: SupervisorExecutionClaimStore,
    private readonly workerCapabilities: SupervisorWorkerCapabilityService,
    private readonly verifierCapabilities: VerifierCapabilityService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
    @Optional() private readonly config?: ConfigService,
  ) {}

  @Post('claim-next')
  @HttpCode(HttpStatus.OK)
  async claimNext(
    @Req() request: BootstrapRequest,
    @Body() body: {
      executionPurpose?: unknown;
      requireFrozenBaseSha?: unknown;
    } = {},
    @Res({ passthrough: true }) response?: Response,
  ): Promise<
    | {
        execution: SupervisorExecution;
        assignment: SupervisorExecution['assignment'];
        capability: string;
      }
    | undefined
  > {
    if (this.config?.get<string>('ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE') === 'required') {
      throw new ForbiddenException('signed_worker_claim_required');
    }
    const executionPurpose =
      body.executionPurpose === undefined
        ? 'IMPLEMENTATION'
        : body.executionPurpose;
    if (
      executionPurpose !== 'IMPLEMENTATION' &&
      executionPurpose !== 'INDEPENDENT_VERIFICATION'
    ) {
      throw new BadRequestException('worker_execution_purpose_invalid');
    }
    if (
      body.requireFrozenBaseSha !== undefined &&
      typeof body.requireFrozenBaseSha !== 'boolean'
    ) {
      throw new BadRequestException('worker_frozen_base_requirement_invalid');
    }
    const requireFrozenBaseSha = body.requireFrozenBaseSha === true;

    const actor = request.supervisorAuthenticatedActor;
    // A registry-backed identity may only claim its configured role/purpose.
    // Legacy role-only credentials are still accepted but remain unproven.
    if (actor &&
      (actor.workerRole !== request.supervisorWorkerBootstrapRole ||
       !actor.purposes.includes(executionPurpose))) {
      throw new BadRequestException('worker_actor_claim_purpose_denied');
    }

    const now = new Date();
    const runnerId = randomUUID();
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + INITIAL_CLAIM_LEASE_MS);

    const claimed = await this.claimStore.claimNext({
      workerRole: request.supervisorWorkerBootstrapRole!,
      executionPurpose,
      requireFrozenBaseSha,
      runnerId,
      leaseId,
      ...(actor ? { bootstrapActor: {
        ...actor, purposes: [...actor.purposes],
        authenticatedAt: now.toISOString(), claimNonce: randomUUID(),
      } } : {}),
      now,
      leaseExpiresAt,
    });

    if (!claimed) {
      response?.status(HttpStatus.NO_CONTENT);
      return undefined;
    }

    const purpose: SupervisorExecutionPurpose =
      claimed.assignment.executionPurpose ?? 'IMPLEMENTATION';

    if (purpose === 'IMPLEMENTATION') {
      const issued = this.workerCapabilities.issue(claimed, { now });
      const executionWithCapability: SupervisorExecution = {
        ...claimed,
        assignment: {
          ...claimed.assignment,
          workerCapability: issued.metadata,
        },
      };
      const persisted = await this.executionStore.saveIfStatus(
        executionWithCapability,
        'RUNNING',
      );
      return {
        execution: persisted,
        assignment: persisted.assignment,
        capability: issued.token,
      };
    }

    if (purpose === 'INDEPENDENT_VERIFICATION') {
      const capability = this.verifierCapabilities.issue(
        {
          taskId: claimed.taskId,
          executionId: claimed.id,
          manifestHash: claimed.assignment.manifestHash!,
          claimEpoch: claimed.assignment.claimEpoch!,
          allowedPaths: claimed.assignment.allowedPaths,
          purpose: 'INDEPENDENT_VERIFICATION',
          leaseId: claimed.assignment.leaseId!,
          runnerId: claimed.assignment.runnerId!,
          ...(claimed.assignment.bootstrapActor ? {
            bootstrapActor: claimed.assignment.bootstrapActor,
          } : {}),
        },
        now,
      );
      const persisted = await this.executionStore.saveIfStatus(
        claimed,
        'RUNNING',
      );
      return {
        execution: persisted,
        assignment: persisted.assignment,
        capability,
      };
    }

    throw new Error('supervisor_execution_purpose_invalid');
  }
}
