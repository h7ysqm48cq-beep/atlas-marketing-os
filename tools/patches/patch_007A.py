from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "007A",
    "name": "Atlas Brain Foundation",
    "version": "0.7.0",
    "requires": ["006A"],
    "description": (
        "Creates the initial Atlas Brain domain with intent detection, "
        "context normalization, planning and orchestration services."
    ),
    "build": [
        ["npm", "run", "build:api"],
    ],
}


BRAIN_TYPES = r"""
export enum AtlasIntent {
  CONTENT_GENERATION = 'CONTENT_GENERATION',
  IMAGE_GENERATION = 'IMAGE_GENERATION',
  CAMPAIGN_PLANNING = 'CAMPAIGN_PLANNING',
  PUBLISHING = 'PUBLISHING',
  SCHEDULING = 'SCHEDULING',
  ANALYSIS = 'ANALYSIS',
  RESEARCH = 'RESEARCH',
  KNOWLEDGE_QUERY = 'KNOWLEDGE_QUERY',
  GENERAL_ASSISTANCE = 'GENERAL_ASSISTANCE',
  UNKNOWN = 'UNKNOWN',
}

export type AtlasConfidence = 'low' | 'medium' | 'high';

export interface AtlasBrainInput {
  message: string;
  userId?: string;
  brandId?: string;
  conversationId?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface AtlasIntentResult {
  intent: AtlasIntent;
  confidence: AtlasConfidence;
  reasons: string[];
  matchedSignals: string[];
}

export interface AtlasBrainContext {
  message: string;
  normalizedMessage: string;
  userId?: string;
  brandId?: string;
  conversationId?: string;
  locale: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AtlasPlanStep {
  id: string;
  order: number;
  action: string;
  description: string;
  required: boolean;
  status: 'pending' | 'ready' | 'blocked';
}

export interface AtlasExecutionPlan {
  intent: AtlasIntent;
  objective: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  steps: AtlasPlanStep[];
}

export interface AtlasBrainResult {
  requestId: string;
  intent: AtlasIntentResult;
  context: AtlasBrainContext;
  plan: AtlasExecutionPlan;
}
""".strip() + "\n"


INTENT_SERVICE = r"""
import { Injectable } from '@nestjs/common';
import {
  AtlasIntent,
  AtlasIntentResult,
} from './brain.types';

interface IntentRule {
  intent: AtlasIntent;
  signals: string[];
  reason: string;
}

@Injectable()
export class IntentService {
  private readonly rules: IntentRule[] = [
    {
      intent: AtlasIntent.PUBLISHING,
      signals: [
        'publish',
        'post now',
        'send now',
        '发布',
        '发出去',
        '发到 facebook',
        '发去 facebook',
        '发到 telegram',
        '发去 telegram',
      ],
      reason: 'The request asks Atlas to publish content.',
    },
    {
      intent: AtlasIntent.SCHEDULING,
      signals: [
        'schedule',
        'queue',
        'tonight at',
        'tomorrow at',
        '排程',
        '安排发布',
        '今晚发布',
        '明天发布',
        '定时',
      ],
      reason: 'The request contains scheduling or timing instructions.',
    },
    {
      intent: AtlasIntent.IMAGE_GENERATION,
      signals: [
        'generate image',
        'create image',
        'make a poster',
        'design a poster',
        '生成图片',
        '做图片',
        '设计图片',
        '海报',
        '生图',
      ],
      reason: 'The user is requesting a visual asset.',
    },
    {
      intent: AtlasIntent.CAMPAIGN_PLANNING,
      signals: [
        'campaign plan',
        'marketing plan',
        'content plan',
        'content calendar',
        'campaign',
        '营销计划',
        '宣传计划',
        '内容规划',
        '活动策划',
      ],
      reason: 'The request is about planning a marketing campaign.',
    },
    {
      intent: AtlasIntent.CONTENT_GENERATION,
      signals: [
        'write a post',
        'write caption',
        'write copy',
        'facebook post',
        'telegram post',
        '写文案',
        '想文案',
        '写贴文',
        '标题',
        'caption',
      ],
      reason: 'The user wants Atlas to create written content.',
    },
    {
      intent: AtlasIntent.ANALYSIS,
      signals: [
        'analyse',
        'analyze',
        'performance',
        'compare',
        'report',
        '分析',
        '表现',
        '数据',
        '报告',
        '比较',
      ],
      reason: 'The request asks for analysis, comparison or reporting.',
    },
    {
      intent: AtlasIntent.RESEARCH,
      signals: [
        'research',
        'find trends',
        'market trend',
        'competitor',
        '调查',
        '研究',
        '趋势',
        '竞争对手',
        '市场资料',
      ],
      reason: 'The request requires research or market discovery.',
    },
    {
      intent: AtlasIntent.KNOWLEDGE_QUERY,
      signals: [
        'knowledge',
        'document',
        'uploaded file',
        'what did we decide',
        '知识库',
        '文件',
        '之前决定',
        '我们说过',
        '历史资料',
      ],
      reason: 'The request depends on stored knowledge or prior decisions.',
    },
  ];

  detect(message: string): AtlasIntentResult {
    const normalized = this.normalize(message);

    if (!normalized) {
      return {
        intent: AtlasIntent.UNKNOWN,
        confidence: 'low',
        reasons: ['No meaningful message was provided.'],
        matchedSignals: [],
      };
    }

    const scored = this.rules
      .map((rule) => {
        const matchedSignals = rule.signals.filter((signal) =>
          normalized.includes(signal.toLowerCase()),
        );

        return {
          rule,
          matchedSignals,
          score: matchedSignals.length,
        };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score);

    const winner = scored[0];

    if (!winner) {
      return {
        intent: AtlasIntent.GENERAL_ASSISTANCE,
        confidence: 'low',
        reasons: [
          'No specialised intent signal was detected.',
          'The request will use the general assistance path.',
        ],
        matchedSignals: [],
      };
    }

    return {
      intent: winner.rule.intent,
      confidence: winner.score >= 2 ? 'high' : 'medium',
      reasons: [winner.rule.reason],
      matchedSignals: winner.matchedSignals,
    };
  }

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}
""".strip() + "\n"


CONTEXT_SERVICE = r"""
import { Injectable } from '@nestjs/common';
import {
  AtlasBrainContext,
  AtlasBrainInput,
} from './brain.types';

@Injectable()
export class BrainContextService {
  build(input: AtlasBrainInput): AtlasBrainContext {
    const message = this.clean(input.message);

    return {
      message,
      normalizedMessage: message.toLowerCase(),
      userId: this.optional(input.userId),
      brandId: this.optional(input.brandId),
      conversationId: this.optional(input.conversationId),
      locale: this.optional(input.locale) ?? 'en-MY',
      metadata: this.cleanMetadata(input.metadata),
      createdAt: new Date().toISOString(),
    };
  }

  private clean(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private optional(value?: string): string | undefined {
    const cleaned = value?.trim();
    return cleaned || undefined;
  }

  private cleanMetadata(
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!metadata) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([key, value]) => key.trim() && value !== undefined,
      ),
    );
  }
}
""".strip() + "\n"


PLANNER_SERVICE = r"""
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
""".strip() + "\n"


ATLAS_BRAIN_SERVICE = r"""
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
""".strip() + "\n"


BRAIN_MODULE = r"""
import { Module } from '@nestjs/common';
import { AtlasBrainService } from './atlas-brain.service';
import { BrainContextService } from './context.service';
import { IntentService } from './intent.service';
import { PlannerService } from './planner.service';

@Module({
  providers: [
    AtlasBrainService,
    IntentService,
    BrainContextService,
    PlannerService,
  ],
  exports: [
    AtlasBrainService,
    IntentService,
    BrainContextService,
    PlannerService,
  ],
})
export class BrainModule {}
""".strip() + "\n"


def apply(context: PatchContext) -> None:
    files = {
        "apps/api/src/brain/brain.types.ts": BRAIN_TYPES,
        "apps/api/src/brain/intent.service.ts": INTENT_SERVICE,
        "apps/api/src/brain/context.service.ts": CONTEXT_SERVICE,
        "apps/api/src/brain/planner.service.ts": PLANNER_SERVICE,
        "apps/api/src/brain/atlas-brain.service.ts":
            ATLAS_BRAIN_SERVICE,
        "apps/api/src/brain/brain.module.ts": BRAIN_MODULE,
    }

    for relative_path, content in files.items():
        context.write_text(relative_path, content)
