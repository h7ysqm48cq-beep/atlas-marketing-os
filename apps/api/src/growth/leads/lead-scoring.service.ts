import { Injectable } from '@nestjs/common';
import { LeadActivityType } from '../../generated/prisma/client';

@Injectable()
export class LeadScoringService {
  getDefaultScore(): number {
    return 10;
  }

  getActivityDelta(type: LeadActivityType): number {
    const scores: Partial<Record<LeadActivityType, number>> = {
      FORM_SUBMITTED: 15,
      MESSAGE_RECEIVED: 10,
      MESSAGE_SENT: 2,
      COMMENTED: 5,
      CLICKED: 3,
      QUALIFIED: 20,
      CONVERTED: 30,
    };

    return scores[type] ?? 0;
  }

  clamp(score: number): number {
    return Math.max(0, Math.min(100, score));
  }
}
