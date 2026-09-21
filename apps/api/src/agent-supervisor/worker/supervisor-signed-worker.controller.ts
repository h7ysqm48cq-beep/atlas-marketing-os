import {
  Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../auth/public.decorator';
import type { AuthenticatedBootstrapActor } from './supervisor-bootstrap-actor-registry';
import type { WorkerExecutionResult } from '../execution/supervisor-execution.types';
import type { ActorPurpose } from '../verification/actor-provenance';
import type { SignedWorkerPreclaimProof } from '../verification/worker-preclaim-proof';
import type { SignedHeartbeatBinding } from '../verification/worker-signed-heartbeat';
import type { SignedTerminalBinding } from '../verification/worker-signed-terminal';
import type {
  ActorSignature, SignedClaimBinding, SignedCompletionBinding,
} from '../verification/signed-execution-attestation';
import { PrismaSupervisorExactClaimStore } from '../persistence/prisma-supervisor-exact-claim.store';
import { SupervisorWorkerBootstrapGuard } from './supervisor-worker-bootstrap.guard';

type SignedRequest = {
  supervisorAuthenticatedActor?: AuthenticatedBootstrapActor;
};
@Public()
@UseGuards(SupervisorWorkerBootstrapGuard)
@Controller('engineering/supervisor/worker/signed')
export class SupervisorSignedWorkerController {
  constructor(
    private readonly store: PrismaSupervisorExactClaimStore,
    private readonly config: ConfigService,
  ) {}

  private authenticated(request: SignedRequest): AuthenticatedBootstrapActor {
    if (this.config.get<string>('ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE') !==
      'required') {
      throw new ForbiddenException('signed_worker_mode_not_enabled');
    }
    // Authenticated registry entry set only by BootstrapGuard, NEVER body.
    const actor = request.supervisorAuthenticatedActor;
    if (!actor?.kid || !actor.principalId ||
        !actor.controllingPrincipalId || !actor.purposes?.length) {
      throw new ForbiddenException('signed_worker_actor_required');
    }
    return actor;
  }

  @Get('next')
  next(@Req() request: SignedRequest, @Query('purpose') purpose: ActorPurpose) {
    const actor = this.authenticated(request);
    if ((purpose !== 'IMPLEMENTATION' &&
         purpose !== 'INDEPENDENT_VERIFICATION') ||
        !actor.purposes.includes(purpose)) {
      throw new ForbiddenException('signed_worker_offer_invalid');
    }
    return this.store.nextQueued({ actor, purpose });
  }

  @Post('offer')
  issueOffer(@Req() request: SignedRequest, @Body() input: {
    executionId: string; purpose: ActorPurpose;
  }) {
    const actor = this.authenticated(request);
    if (!input || typeof input.executionId !== 'string' ||
        !input.executionId.trim() ||
        (input.purpose !== 'IMPLEMENTATION' &&
         input.purpose !== 'INDEPENDENT_VERIFICATION') ||
        !actor.purposes.includes(input.purpose)) {
      throw new ForbiddenException('signed_worker_offer_invalid');
    }
    return this.store.issueOffer({
      actor, executionId: input.executionId, purpose: input.purpose,
    });
  }

  @Post('claim')
  claim(@Req() request: SignedRequest, @Body() input: {
    challengeId: string;
    preclaimProof: SignedWorkerPreclaimProof;
    claimProof: ActorSignature<SignedClaimBinding>;
  }) {
    const actor = this.authenticated(request);
    if (!input || typeof input.challengeId !== 'string' ||
        !input.challengeId.trim() ||
        !input.preclaimProof || !input.claimProof) {
      throw new ForbiddenException('signed_worker_claim_invalid');
    }
    return this.store.claimOffer({
      actor, challengeId: input.challengeId,
      preclaimProof: input.preclaimProof, claimProof: input.claimProof,
    });
  }

  @Post('heartbeat')
  heartbeat(@Req() request: SignedRequest, @Body() input: {
    executionId: string; proof: ActorSignature<SignedHeartbeatBinding>;
  }) {
    const actor = this.authenticated(request);
    if (!input || typeof input.executionId !== 'string' ||
        !input.executionId.trim() || !input.proof) {
      throw new ForbiddenException('signed_worker_heartbeat_invalid');
    }
    return this.store.heartbeatSigned({ actor,
      executionId: input.executionId, proof: input.proof,
    });
  }

  @Post('terminate')
  terminate(@Req() request: SignedRequest, @Body() input: {
    executionId: string; proof: ActorSignature<SignedTerminalBinding>;
  }) {
    const actor = this.authenticated(request);
    if (!input || typeof input.executionId !== 'string' ||
        !input.executionId.trim() || !input.proof) {
      throw new ForbiddenException('signed_worker_terminal_invalid');
    }
    return this.store.terminateSigned({ actor,
      executionId: input.executionId, proof: input.proof,
    });
  }

  @Post('complete')
  complete(@Req() request: SignedRequest, @Body() input: {
    executionId: string;
    result: WorkerExecutionResult;
    completionProof: ActorSignature<SignedCompletionBinding>;
  }) {
    const actor = this.authenticated(request);
    if (!input || typeof input.executionId !== 'string' ||
        !input.executionId.trim() ||
        !input.result || !input.completionProof) {
      throw new ForbiddenException('signed_worker_completion_invalid');
    }
    return this.store.completeSigned({
      actor, executionId: input.executionId,
      result: input.result, completionProof: input.completionProof,
    });
  }
}
