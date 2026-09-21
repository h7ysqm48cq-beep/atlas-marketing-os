import {
  Body, Controller, ForbiddenException, Post, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaSupervisorSignedReviewStore } from '../persistence/prisma-supervisor-signed-review.store';
import { SupervisorSignedCoordinationService } from './supervisor-signed-coordination.service';
import {
  SupervisorSystemGuard, SupervisorSystemPurposeRequired,
  SupervisorSystemRequestBindingRequired,
} from './supervisor-system.guard';

/**
 * Control-plane only: signed workers cannot release their own locks. Existing
 * system guard enforces a signed SUPERVISOR_SYSTEM assertion and purpose.
 */
@UseGuards(SupervisorSystemGuard)
@Controller('engineering/supervisor/system/signed-review')
export class SupervisorSignedReviewController {
  constructor(
    private readonly store: PrismaSupervisorSignedReviewStore,
    private readonly config: ConfigService,
    private readonly coordination?: SupervisorSignedCoordinationService,
  ) {}
  @Post('advance')
  @SupervisorSystemPurposeRequired('VERIFICATION_COORDINATION')
  @SupervisorSystemRequestBindingRequired('SIGNED_ADVANCE')
  advance(@Body() input: { taskId: string }) {
    if (!this.coordination) {
      throw new ForbiddenException('signed_coordination_unavailable');
    }
    return this.coordination.advanceTask(input?.taskId);
  }

  @Post('ready')
  @SupervisorSystemPurposeRequired('VERIFICATION_COORDINATION')
  @SupervisorSystemRequestBindingRequired('SIGNED_READY')
  releaseReady(@Body() input: {
    taskId: string; expectedTaskVersion: string;
  }) {
    if (this.config.get<string>('ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE') !==
      'required') {
      throw new ForbiddenException('signed_review_mode_not_enabled');
    }
    if (!input || typeof input.taskId !== 'string' ||
        !input.taskId.trim() ||
        typeof input.expectedTaskVersion !== 'string' ||
        !Number.isFinite(Date.parse(input.expectedTaskVersion))) {
      throw new ForbiddenException('signed_review_request_invalid');
    }
    return this.store.releaseReady(input);
  }
}
