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
