import { Injectable } from '@nestjs/common';
import { IntentType } from '../types/intent';

export type IntentClassification = {
  intent: IntentType;
  confidence: number;
  reason: string;
};

type IntentRule = {
  intent: IntentType;
  keywords: string[];
  reason: string;
};

@Injectable()
export class IntentEngine {
  private readonly rules: IntentRule[] = [
    {
      intent: IntentType.ANALYTICS,
      keywords: [
        '分析',
        '表现',
        '成效',
        '流量',
        '数据',
        '为什么没人',
        '为什么没有',
        'analytics',
        'analysis',
        'performance',
        'insight',
        'reach',
        'engagement rate',
      ],
      reason:
        'The request asks for performance analysis or marketing insights.',
    },
    {
      intent: IntentType.SEO,
      keywords: [
        'seo',
        'keyword',
        'keywords',
        '关键词',
        '搜索排名',
        'meta title',
        'meta description',
      ],
      reason:
        'The request relates to search optimization or keywords.',
    },
    {
      intent: IntentType.IMAGE,
      keywords: [
        '图片',
        '图像',
        '海报',
        '视觉',
        'banner',
        'poster',
        'image',
        'visual',
        'design',
      ],
      reason:
        'The request asks for an image, visual asset, or design.',
    },
    {
      intent: IntentType.COPYWRITING,
      keywords: [
        '文案',
        '改写',
        '优化这段',
        'caption',
        'copywriting',
        'copy',
        'rewrite',
        'facebook post',
        'telegram post',
        'instagram post',
        'ig post',
        'instagram caption',
        'ig caption',
        'ig文案',
        'instagram文案',
      ],
      reason:
        'The request asks for copywriting or content rewriting.',
    },
    {
      intent: IntentType.CAMPAIGN_CREATION,
      keywords: [
        'campaign',
        '活动',
        '营销方案',
        '营销计划',
        '宣传系列',
        '内容系列',
        '企划',
        'campaign plan',
        'marketing plan',
      ],
      reason:
        'The request asks to create or plan a marketing campaign.',
    },
  ];

  classify(prompt: string): IntentClassification {
    const normalized = prompt
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return {
        intent: IntentType.UNKNOWN,
        confidence: 0,
        reason: 'The request is empty.',
      };
    }

    for (const rule of this.rules) {
      const matchedKeyword = rule.keywords.find(
        (keyword) =>
          normalized.includes(keyword.toLowerCase()),
      );

      if (matchedKeyword) {
        return {
          intent: rule.intent,
          confidence: 0.9,
          reason: `${rule.reason} Matched: "${matchedKeyword}".`,
        };
      }
    }

    return {
      intent: IntentType.UNKNOWN,
      confidence: 0.35,
      reason:
        'No supported strategy intent rule matched the request.',
    };
  }
}
