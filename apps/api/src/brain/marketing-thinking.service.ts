import { Injectable } from '@nestjs/common';

export type MarketingPlatform =
  'FACEBOOK' | 'TELEGRAM' | 'REELS' | 'IMAGE' | 'MULTI_PLATFORM';

export type MarketingObjective =
  | 'DISCUSSION'
  | 'AWARENESS'
  | 'COMMUNITY_GROWTH'
  | 'ENGAGEMENT'
  | 'EDUCATION'
  | 'CONVERSION'
  | 'BRAND_RECALL';

export type MarketingThinkingInput = {
  topic: string;
  platforms: string[];
  style: string;
  language: string;

  brandName: string;
  targetAudience: string;
  brandVoice: string;
  visualStyle: string;
  contentGoals: string;
  callsToAction: string[];
  keywords: string[];
  forbiddenWords: string[];
  brandRules: string[];

  campaign?: {
    name: string;
    objective?: string | null;
  } | null;

  memory?: {
    preferredStyle?: string | null;
    bestPlatform?: string | null;
    bestPostingTime?: string | null;
    recommendations?: string[];
  } | null;
};

export type MarketingThinkingResult = {
  objective: MarketingObjective;
  primaryPlatform: MarketingPlatform;
  audience: string;
  recommendedTone: string;
  contentAngle: string;
  emotionalDirection: string;
  recommendedCta: string;
  recommendedPostingTime: string | null;
  visualDirection: string;
  mustInclude: string[];
  risksToAvoid: string[];
  reasoning: string[];
  promptContext: string;
};

@Injectable()
export class MarketingThinkingService {
  think(input: MarketingThinkingInput): MarketingThinkingResult {
    const primaryPlatform = this.resolvePrimaryPlatform(input.platforms);

    const objective = this.resolveObjective(input);

    const recommendedTone = this.resolveTone(input, objective);

    const contentAngle = this.resolveContentAngle(
      input,
      objective,
      primaryPlatform,
    );

    const emotionalDirection = this.resolveEmotion(input, objective);

    const recommendedCta = this.resolveCta(input, objective);

    const visualDirection = this.resolveVisualDirection(input, primaryPlatform);

    const mustInclude = this.resolveMustInclude(input);

    const risksToAvoid = this.resolveRisks(input);

    const reasoning = [
      `Primary objective is ${this.labelObjective(
        objective,
      )} based on the brand content goals and current topic.`,
      `${this.labelPlatform(
        primaryPlatform,
      )} is treated as the primary platform for format and engagement decisions.`,
      `The recommended tone follows the configured brand voice while adapting to the requested style.`,
      `The CTA is selected to support the marketing objective without conflicting with Brand Brain restrictions.`,
      `Visual direction follows the saved visual system and should remain secondary to the explicit user request.`,
    ];

    const result: MarketingThinkingResult = {
      objective,
      primaryPlatform,
      audience: input.targetAudience,
      recommendedTone,
      contentAngle,
      emotionalDirection,
      recommendedCta,
      recommendedPostingTime: input.memory?.bestPostingTime || null,
      visualDirection,
      mustInclude,
      risksToAvoid,
      reasoning,
      promptContext: '',
    };

    result.promptContext = this.buildPromptContext(result);

    return result;
  }

  private resolvePrimaryPlatform(platforms: string[]): MarketingPlatform {
    const normalized = platforms.map((item) => item.trim().toLowerCase());

    if (normalized.includes('facebook')) {
      return 'FACEBOOK';
    }

    if (normalized.includes('telegram')) {
      return 'TELEGRAM';
    }

    if (normalized.includes('reels') || normalized.includes('reel')) {
      return 'REELS';
    }

    if (
      normalized.includes('image') ||
      normalized.includes('image prompt') ||
      normalized.includes('visual')
    ) {
      return 'IMAGE';
    }

    return 'MULTI_PLATFORM';
  }

  private resolveObjective(input: MarketingThinkingInput): MarketingObjective {
    const source = [
      input.topic,
      input.contentGoals,
      input.campaign?.objective || '',
    ]
      .join(' ')
      .toLowerCase();

    if (
      this.containsAny(source, [
        'discussion',
        'comment',
        'conversation',
        '讨论',
        '留言',
        '互动话题',
      ])
    ) {
      return 'DISCUSSION';
    }

    if (
      this.containsAny(source, [
        'telegram',
        'community',
        'group',
        '社群',
        '群组',
      ])
    ) {
      return 'COMMUNITY_GROWTH';
    }

    if (
      this.containsAny(source, [
        'educate',
        'explain',
        'guide',
        'learn',
        '教育',
        '解释',
        '教学',
      ])
    ) {
      return 'EDUCATION';
    }

    if (
      this.containsAny(source, [
        'convert',
        'sales',
        'signup',
        'join now',
        '成交',
        '注册',
      ])
    ) {
      return 'CONVERSION';
    }

    if (
      this.containsAny(source, [
        'nostalgia',
        'recall',
        'remember',
        '怀旧',
        '回忆',
      ])
    ) {
      return 'BRAND_RECALL';
    }

    if (
      this.containsAny(source, ['engagement', 'viral', 'share', '互动', '分享'])
    ) {
      return 'ENGAGEMENT';
    }

    return 'AWARENESS';
  }

  private resolveTone(
    input: MarketingThinkingInput,
    objective: MarketingObjective,
  ): string {
    const requestedStyle = input.style.trim() || 'Brand default';

    const objectiveTone: Record<MarketingObjective, string> = {
      DISCUSSION: 'Conversational, relatable and question-led',
      AWARENESS: 'Clear, memorable and brand-aligned',
      COMMUNITY_GROWTH: 'Welcoming, inclusive and community-oriented',
      ENGAGEMENT: 'Energetic, accessible and shareable',
      EDUCATION: 'Helpful, structured and easy to understand',
      CONVERSION: 'Persuasive but restrained and trustworthy',
      BRAND_RECALL: 'Warm, emotional and nostalgic',
    };

    return [input.brandVoice, requestedStyle, objectiveTone[objective]]
      .filter(Boolean)
      .join(' · ');
  }

  private resolveContentAngle(
    input: MarketingThinkingInput,
    objective: MarketingObjective,
    platform: MarketingPlatform,
  ): string {
    const topic = input.topic.trim();

    const angleByObjective: Record<MarketingObjective, string> = {
      DISCUSSION: `Turn "${topic}" into a relatable situation followed by one clear discussion question.`,
      AWARENESS: `Present "${topic}" through one memorable insight that reinforces brand positioning.`,
      COMMUNITY_GROWTH: `Use "${topic}" to create belonging and give the audience a reason to join the wider community.`,
      ENGAGEMENT: `Lead with a fast, recognisable hook about "${topic}", then invite a reaction or share.`,
      EDUCATION: `Explain "${topic}" through a simple problem–insight–action structure.`,
      CONVERSION: `Connect "${topic}" to one practical benefit and one restrained next action.`,
      BRAND_RECALL: `Use "${topic}" as an emotional memory trigger that feels familiar to the target audience.`,
    };

    return [angleByObjective[objective], this.platformAngle(platform)].join(
      ' ',
    );
  }

  private resolveEmotion(
    input: MarketingThinkingInput,
    objective: MarketingObjective,
  ): string {
    const topic = input.topic.toLowerCase();

    if (this.containsAny(topic, ['funny', '搞笑', '幽默', 'meme'])) {
      return 'Light humour and social recognition';
    }

    if (objective === 'BRAND_RECALL') {
      return 'Nostalgia, warmth and shared memory';
    }

    if (objective === 'DISCUSSION') {
      return 'Recognition, curiosity and personal opinion';
    }

    if (objective === 'COMMUNITY_GROWTH') {
      return 'Belonging and inclusion';
    }

    return 'Clarity, relevance and positive interest';
  }

  private resolveCta(
    input: MarketingThinkingInput,
    objective: MarketingObjective,
  ): string {
    const configured = input.callsToAction
      .map((cta) => cta.trim())
      .filter(Boolean);

    const preferredPatterns: Record<MarketingObjective, string[]> = {
      DISCUSSION: [
        'comment',
        'tell us',
        'share your experience',
        '留言',
        '告诉我们',
      ],
      AWARENESS: ['learn more', '了解更多'],
      COMMUNITY_GROWTH: ['telegram', 'join', '加入'],
      ENGAGEMENT: ['share', 'comment', '分享', '留言'],
      EDUCATION: ['learn more', 'save', '收藏'],
      CONVERSION: ['learn more', 'join', '了解更多', '加入'],
      BRAND_RECALL: ['tell us', 'share your experience', '你还记得吗'],
    };

    const patterns = preferredPatterns[objective];

    const matched = configured.find((cta) =>
      patterns.some((pattern) =>
        cta.toLowerCase().includes(pattern.toLowerCase()),
      ),
    );

    if (matched) {
      return matched;
    }

    if (configured[0]) {
      return configured[0];
    }

    const fallbacks: Record<MarketingObjective, string> = {
      DISCUSSION: 'Tell us your experience in the comments.',
      AWARENESS: 'Learn more.',
      COMMUNITY_GROWTH: 'Join the community.',
      ENGAGEMENT: 'Share your view.',
      EDUCATION: 'Save this for later.',
      CONVERSION: 'Learn more.',
      BRAND_RECALL: 'What do you remember most?',
    };

    return fallbacks[objective];
  }

  private resolveVisualDirection(
    input: MarketingThinkingInput,
    platform: MarketingPlatform,
  ): string {
    const platformRule: Record<MarketingPlatform, string> = {
      FACEBOOK:
        'Use a strong feed-first composition with an immediately readable focal subject.',
      TELEGRAM:
        'Use a clean visual that remains understandable in compact mobile preview.',
      REELS:
        'Use vertical framing, clear subject hierarchy and strong first-frame impact.',
      IMAGE:
        'Create a production-ready visual direction with explicit subject, composition, lighting and exclusions.',
      MULTI_PLATFORM:
        'Use an adaptable composition that can be resized without losing the main subject.',
    };

    return [input.visualStyle, platformRule[platform]]
      .filter(Boolean)
      .join(' ');
  }

  private resolveMustInclude(input: MarketingThinkingInput): string[] {
    const items = [
      `Brand alignment: ${input.brandName}`,
      `Audience relevance: ${input.targetAudience}`,
      `Language: ${input.language}`,
    ];

    if (input.keywords.length) {
      items.push(
        `Relevant keywords where natural: ${input.keywords
          .slice(0, 6)
          .join(', ')}`,
      );
    }

    if (input.campaign) {
      items.push(`Campaign alignment: ${input.campaign.name}`);
    }

    return items;
  }

  private resolveRisks(input: MarketingThinkingInput): string[] {
    const risks = [
      ...input.forbiddenWords.map((word) => `Do not use or imply: ${word}`),
      ...input.brandRules
        .filter((rule) =>
          this.containsAny(rule.toLowerCase(), [
            'avoid',
            'do not',
            'never',
            '不要',
            '禁止',
          ]),
        )
        .map((rule) => rule),
    ];

    return Array.from(new Set(risks)).slice(0, 12);
  }

  private buildPromptContext(result: MarketingThinkingResult): string {
    return [
      'MARKETING THINKING',
      `Objective: ${this.labelObjective(result.objective)}`,
      `Primary platform: ${this.labelPlatform(result.primaryPlatform)}`,
      `Audience: ${result.audience}`,
      `Recommended tone: ${result.recommendedTone}`,
      `Content angle: ${result.contentAngle}`,
      `Emotional direction: ${result.emotionalDirection}`,
      `Recommended CTA: ${result.recommendedCta}`,
      `Recommended posting time: ${
        result.recommendedPostingTime || 'No reliable learned time available'
      }`,
      `Visual direction: ${result.visualDirection}`,
      '',
      'MUST INCLUDE',
      ...result.mustInclude.map((item) => `- ${item}`),
      '',
      'RISKS TO AVOID',
      ...(result.risksToAvoid.length
        ? result.risksToAvoid.map((item) => `- ${item}`)
        : ['- No additional risks identified.']),
      '',
      'MARKETING DECISION REASONS',
      ...result.reasoning.map((item) => `- ${item}`),
      '',
      'Use these decisions as internal planning guidance.',
      'The current explicit user request remains the highest priority.',
      'Do not expose internal marketing reasoning labels in the final output.',
    ].join('\n');
  }

  private platformAngle(platform: MarketingPlatform): string {
    const angles: Record<MarketingPlatform, string> = {
      FACEBOOK:
        'Prioritise a strong opening, readable paragraph length and one discussion trigger.',
      TELEGRAM:
        'Keep the structure concise, direct and easy to scan on mobile.',
      REELS:
        'Build around a first-second hook, short progression and memorable ending.',
      IMAGE:
        'Translate the idea into a clear visual story with one dominant focal point.',
      MULTI_PLATFORM:
        'Keep the central idea adaptable while preserving platform-specific formatting.',
    };

    return angles[platform];
  }

  private containsAny(source: string, terms: string[]): boolean {
    return terms.some((term) => source.includes(term.toLowerCase()));
  }

  private labelObjective(objective: MarketingObjective): string {
    return objective
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (value) => value.toUpperCase());
  }

  private labelPlatform(platform: MarketingPlatform): string {
    return platform
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (value) => value.toUpperCase());
  }
}
