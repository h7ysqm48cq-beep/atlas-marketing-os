import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
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

const INITIAL_CLAIM_LEASE_MS = 60_000;

type BootstrapRequest = Request & {
  supervisorWorkerBootstrapRole?: SupervisorExecution['workerRole'];
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
          ...(claimed.assignment.candidateHeadSha
            ? { candidateHeadSha: claimed.assignment.candidateHeadSha }
            : {}),
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

  @Post('claim-exact')
  @HttpCode(HttpStatus.OK)
  async claimExact(
    @Req() request: BootstrapRequest,
    @Body() body: {
      taskId?: unknown;
      executionId?: unknown;
      executionPurpose?: unknown;
      requireCandidateHeadSha?: unknown;
    } = {},
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (
      typeof body.taskId !== 'string' || !body.taskId ||
      typeof body.executionId !== 'string' || !body.executionId ||
      body.executionPurpose !== 'INDEPENDENT_VERIFICATION' ||
      body.requireCandidateHeadSha !== true
    ) {
      throw new BadRequestException('worker_exact_claim_invalid');
    }
    const now = new Date();
    const runnerId = randomUUID();
    const leaseId = randomUUID();
    const claimed = await this.claimStore.claimExact({
      taskId: body.taskId,
      executionId: body.executionId,
      workerRole: request.supervisorWorkerBootstrapRole!,
      executionPurpose: 'INDEPENDENT_VERIFICATION',
      requireCandidateHeadSha: true,
      runnerId,
      leaseId,
      now,
      leaseExpiresAt: new Date(now.getTime() + INITIAL_CLAIM_LEASE_MS),
    });
    if (!claimed) {
      response?.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    const capability = this.verifierCapabilities.issue({
      taskId: claimed.taskId,
      executionId: claimed.id,
      manifestHash: claimed.assignment.manifestHash!,
      claimEpoch: claimed.assignment.claimEpoch!,
      allowedPaths: claimed.assignment.allowedPaths,
      purpose: 'INDEPENDENT_VERIFICATION',
      leaseId: claimed.assignment.leaseId!,
      runnerId: claimed.assignment.runnerId!,
      candidateHeadSha: claimed.assignment.candidateHeadSha!,
    }, now);
    const persisted = await this.executionStore.saveIfStatus(claimed, 'RUNNING');
    return { execution: persisted, assignment: persisted.assignment, capability };
  }
}
