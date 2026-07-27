import { Injectable } from '@nestjs/common';
import type {
  AgentExecutionStep,
  AgentWorkflowState,
} from './agent-workflow.types';

@Injectable()
export class AgentWorkflowService {
  status() {
    return {
      engine: 'agent-workflow',
      status: 'ready',
      architecture: [
        'planner',
        'writer',
        'reviewer',
        'image-director',
        'publisher',
      ],
    };
  }

  createWorkflowState(): AgentWorkflowState {
    const workflowId =
      `workflow-${Date.now()}`;

    return {
      workflowId,
      status: 'pending',
      progress: 0,
      currentAgent: null,
      steps: this.createSteps(),
      createdAt: new Date(),
      completedAt: null,
    };
  }

  private createSteps(): AgentExecutionStep[] {
    return [
      {
        agent: 'planner',
        label: 'Planner Agent',
        description:
          'Creates the marketing strategy and execution plan.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        error: null,
      },
      {
        agent: 'writer',
        label: 'Writer Agent',
        description:
          'Creates platform-specific marketing content.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        error: null,
      },
      {
        agent: 'reviewer',
        label: 'Reviewer Agent',
        description:
          'Checks brand fit, quality, safety and engagement.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        error: null,
      },
      {
        agent: 'image-director',
        label: 'Image Director Agent',
        description:
          'Creates platform-specific visual direction.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        error: null,
      },
      {
        agent: 'publisher',
        label: 'Publisher Agent',
        description:
          'Prepares approved content for queue or publishing.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        error: null,
      },
    ];
  }
}
