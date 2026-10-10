import { Injectable } from '@nestjs/common';
import {
  AtlasBrainContext,
  AtlasExecutionPlan,
  AtlasIntent,
  AtlasIntentResult,
  AtlasPlanStep,
} from './brain.types';

@Injectable()
export class PlannerService {
  createPlan(
    intentResult: AtlasIntentResult,
    context: AtlasBrainContext,
  ): AtlasExecutionPlan {
    const steps = this.stepsFor(intentResult.intent);
    const needsClarification =
      intentResult.intent === AtlasIntent.UNKNOWN ||
      context.message.length === 0;

    return {
      intent: intentResult.intent,
      objective: this.objectiveFor(intentResult.intent),
      needsClarification,
      clarificationQuestion: needsClarification
        ? 'What would you like Atlas to help you accomplish?'
        : undefined,
      steps,
    };
  }

  private stepsFor(intent: AtlasIntent): AtlasPlanStep[] {
    const actions = this.actionsFor(intent);

    return actions.map((item, index) => ({
      id: `${intent.toLowerCase()}-${index + 1}`,
      order: index + 1,
      action: item.action,
      description: item.description,
      required: item.required,
      status: 'pending',
    }));
  }

  private actionsFor(
    intent: AtlasIntent,
  ): Array<{
    action: string;
    description: string;
    required: boolean;
  }> {
    switch (intent) {
      case AtlasIntent.CONTENT_GENERATION:
        return [
          {
            action: 'load_brand_context',
            description:
              'Load brand voice, audience and content guidelines.',
            required: true,
          },
          {
            action: 'retrieve_relevant_knowledge',
            description:
              'Find relevant examples, decisions and campaign knowledge.',
            required: true,
          },
          {
            action: 'generate_content',
            description:
              'Create content that satisfies the user objective.',
            required: true,
          },
          {
            action: 'review_brand_fit',
            description:
              'Review tone, clarity and brand consistency.',
            required: true,
          },
        ];

      case AtlasIntent.IMAGE_GENERATION:
        return [
          {
            action: 'define_visual_objective',
            description:
              'Extract format, subject, mood and platform requirements.',
            required: true,
          },
          {
            action: 'load_visual_brand_context',
            description:
              'Load visual identity and previous approved assets.',
            required: true,
          },
          {
            action: 'prepare_image_request',
            description:
              'Build a production-ready image generation request.',
            required: true,
          },
        ];

      case AtlasIntent.CAMPAIGN_PLANNING:
        return [
          {
            action: 'define_campaign_goal',
            description:
              'Confirm the campaign goal, audience and success criteria.',
            required: true,
          },
          {
            action: 'research_context',
            description:
              'Gather relevant brand, audience and market context.',
            required: true,
          },
          {
            action: 'create_campaign_strategy',
            description:
              'Create campaign direction, channels and content pillars.',
            required: true,
          },
          {
            action: 'create_execution_plan',
            description:
              'Turn the strategy into concrete actions and deliverables.',
            required: true,
          },
        ];

      case AtlasIntent.PUBLISHING:
      case AtlasIntent.SCHEDULING:
        return [
          {
            action: 'validate_content',
            description:
              'Confirm that publishable content and channel data exist.',
            required: true,
          },
          {
            action: 'validate_channel',
            description:
              'Confirm the destination channel is connected.',
            required: true,
          },
          {
            action:
              intent === AtlasIntent.SCHEDULING
                ? 'schedule_publication'
                : 'publish_content',
            description:
              intent === AtlasIntent.SCHEDULING
                ? 'Create a scheduled publishing job.'
                : 'Send the approved content to the selected channel.',
            required: true,
          },
        ];

      case AtlasIntent.ANALYSIS:
        return [
          {
            action: 'identify_data_sources',
            description:
              'Identify the data required for a reliable analysis.',
            required: true,
          },
          {
            action: 'analyse_data',
            description:
              'Evaluate results, patterns and meaningful differences.',
            required: true,
          },
          {
            action: 'recommend_next_actions',
            description:
              'Translate findings into practical next actions.',
            required: true,
          },
        ];

      case AtlasIntent.RESEARCH:
        return [
          {
            action: 'define_research_question',
            description:
              'Convert the request into a focused research question.',
            required: true,
          },
          {
            action: 'collect_sources',
            description:
              'Collect reliable and relevant information.',
            required: true,
          },
          {
            action: 'synthesise_findings',
            description:
              'Summarise findings and implications for the user.',
            required: true,
          },
        ];

      case AtlasIntent.KNOWLEDGE_QUERY:
        return [
          {
            action: 'retrieve_knowledge',
            description:
              'Retrieve relevant knowledge and conversation memory.',
            required: true,
          },
          {
            action: 'answer_with_evidence',
            description:
              'Answer using the retrieved information.',
            required: true,
          },
        ];

      case AtlasIntent.UNKNOWN:
        return [];

      case AtlasIntent.GENERAL_ASSISTANCE:
      default:
        return [
          {
            action: 'understand_request',
            description:
              'Clarify the user objective and relevant context.',
            required: true,
          },
          {
            action: 'respond',
            description:
              'Provide the most useful next response or action.',
            required: true,
          },
        ];
    }
  }

  private objectiveFor(intent: AtlasIntent): string {
    const objectives: Record<AtlasIntent, string> = {
      [AtlasIntent.CONTENT_GENERATION]:
        'Create brand-aligned marketing content.',
      [AtlasIntent.IMAGE_GENERATION]:
        'Prepare or generate an effective visual asset.',
      [AtlasIntent.CAMPAIGN_PLANNING]:
        'Build an actionable marketing campaign plan.',
      [AtlasIntent.PUBLISHING]:
        'Publish approved content to the selected channel.',
      [AtlasIntent.SCHEDULING]:
        'Schedule approved content for future publication.',
      [AtlasIntent.ANALYSIS]:
        'Produce useful findings and recommended actions.',
      [AtlasIntent.RESEARCH]:
        'Find and synthesise relevant information.',
      [AtlasIntent.KNOWLEDGE_QUERY]:
        'Answer from Atlas knowledge and memory.',
      [AtlasIntent.GENERAL_ASSISTANCE]:
        'Help the user complete the requested task.',
      [AtlasIntent.UNKNOWN]:
        'Clarify the user request.',
    };

    return objectives[intent];
  }
}
