import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BrainContextService } from './context.service';
import { IntentService } from './intent.service';
import { PlannerService } from './planner.service';
import {
  AtlasBrainInput,
  AtlasBrainResult,
} from './brain.types';

@Injectable()
export class AtlasBrainService {
  constructor(
    private readonly intentService: IntentService,
    private readonly contextService: BrainContextService,
    private readonly plannerService: PlannerService,
  ) {}

  think(input: AtlasBrainInput): AtlasBrainResult {
    const context = this.contextService.build(input);
    const intent = this.intentService.detect(context.message);
    const plan = this.plannerService.createPlan(intent, context);

    return {
      requestId: randomUUID(),
      intent,
      context,
      plan,
    };
  }
}
