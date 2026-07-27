import { Injectable } from '@nestjs/common';
import { ContextService } from '../context/context.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class PlannerService {
  constructor(
    private readonly contextService: ContextService,
  ) {}

  status() {
    return {
      stage: 'planner',
      status: 'ready',
    };
  }

  async plan(dto: CreatePlanDto) {
    const context = await this.contextService.build({
      prompt: dto.prompt,
      campaignId: dto.campaignId,
      platforms: dto.platforms,
      language: dto.language,
      style: dto.style,
      knowledgeLimit: 5,
    });

    return {
      stage: 'planner',
      status: 'planned',

      brandContext: context.brand,

      memoryContext: context.memory,

      knowledgeContext: context.knowledge,

      request: context.request,

      plan: {
        objective:
          'Create useful marketing content aligned with the user request.',

        audience:
          context.brand.targetAudience,

        steps: [
          'Understand the current user request.',
          'Load Brand Brain rules.',
          'Load confirmed long-term memory.',
          'Retrieve relevant Knowledge documents.',
          'Select an appropriate marketing strategy.',
          'Generate platform-specific content.',
          'Run quality and safety checks.',
        ],
      },

      contextMetadata: context.metadata,
    };
  }
}
