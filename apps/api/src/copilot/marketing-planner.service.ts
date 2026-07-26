import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';

export type MarketingPlanScheduleItem = {
  day: number;
  platform: string;
  contentType: string;
  topic: string;
};

export type MarketingPlan = {
  campaignName: string;
  objective: string;
  audience: string;
  hook: string;
  keyMessage: string;
  contentPillars: string[];
  contentIdeas: string[];
  facebook: string[];
  telegram: string[];
  reels: string[];
  imagePrompts: string[];
  schedule: MarketingPlanScheduleItem[];
  generatedBy?: 'ai' | 'fallback';
  warning?: string;
};

const MARKETING_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    campaignName: {
      type: 'string',
    },
    objective: {
      type: 'string',
    },
    audience: {
      type: 'string',
    },
    hook: {
      type: 'string',
    },
    keyMessage: {
      type: 'string',
    },
    contentPillars: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    contentIdeas: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    facebook: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    telegram: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    reels: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    imagePrompts: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    schedule: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          day: {
            type: 'number',
          },
          platform: {
            type: 'string',
          },
          contentType: {
            type: 'string',
          },
          topic: {
            type: 'string',
          },
        },
        required: [
          'day',
          'platform',
          'contentType',
          'topic',
        ],
      },
    },
  },
  required: [
    'campaignName',
    'objective',
    'audience',
    'hook',
    'keyMessage',
    'contentPillars',
    'contentIdeas',
    'facebook',
    'telegram',
    'reels',
    'imagePrompts',
    'schedule',
  ],
} as const;

@Injectable()
export class MarketingPlannerService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly config: ConfigService,
    private readonly brands: BrandsService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey =
      this.config.get<string>('OPENAI_API_KEY');

    this.client = apiKey
      ? new OpenAI({
          apiKey,
          timeout: 60_000,
          maxRetries: 2,
        })
      : null;
  }

  async generate(
    dto: CreateMarketingPlanDto,
  ): Promise<MarketingPlan> {
    const prompt = dto.prompt.trim();
    const brand = await this.brands.getActiveBrand();

    const campaign = dto.campaignId
      ? await this.prisma.campaign.findFirst({
          where: {
            id: dto.campaignId,
            brandId: brand.id,
          },
          select: {
            id: true,
            name: true,
            description: true,
            objective: true,
          },
        })
      : null;

    if (dto.campaignId && !campaign) {
      throw new NotFoundException(
        'Campaign not found.',
      );
    }

    const fallback = this.createFallbackPlan(
      prompt,
      this.toText(brand.targetAudience),
    );

    if (!this.client) {
      return {
        ...fallback,
        generatedBy: 'fallback',
        warning:
          'OPENAI_API_KEY is not configured. Returned the safe fallback plan.',
      };
    }

    const developerContext = [
      'You are Elena, the senior AI marketing strategist inside Atlas Marketing OS.',
      'Create a practical, commercially useful multi-platform marketing plan.',
      '',
      `Brand name: ${this.toText(brand.name)}`,
      `Country: ${this.toText(brand.country)}`,
      `Target audience: ${this.toText(brand.targetAudience)}`,
      `Brand voice: ${this.toText(brand.brandVoice)}`,
      `Visual style: ${this.toText(brand.visualStyle)}`,
      `Content goals: ${this.toText(brand.contentGoals)}`,
      `Keywords: ${this.toList(brand.keywords)}`,
      `Brand rules: ${this.toList(brand.brandRules)}`,
      `Forbidden words: ${this.toList(brand.forbiddenWords)}`,
      campaign
        ? [
            `Existing campaign: ${campaign.name}`,
            `Campaign objective: ${campaign.objective || 'Not set'}`,
            `Campaign description: ${campaign.description || 'Not set'}`,
          ].join('\n')
        : 'Existing campaign: none selected',
      '',
      'Requirements:',
      '- Use the language requested by the user. For a Chinese request, use natural Simplified Chinese suitable for Malaysian Chinese audiences.',
      '- Produce 4 to 6 distinct content pillars.',
      '- Produce 10 practical content ideas.',
      '- Produce 3 ready-to-use Facebook captions.',
      '- Produce 3 concise Telegram captions.',
      '- Produce 3 Reels concepts with hook, scene direction and ending CTA.',
      '- Produce 3 detailed English image-generation prompts.',
      '- Produce a realistic 7-day publishing schedule.',
      '- Adapt each platform version instead of copying the same text.',
      '- Avoid unsupported current claims, fake urgency and prohibited brand wording.',
      '- Keep promotional language natural and aligned with the Brand Brain.',
      '- Return only data matching the required JSON schema.',
    ].join('\n');

    try {
      const response =
        await this.client.responses.create({
          model:
            this.config.get<string>(
              'OPENAI_MODEL',
            ) || 'gpt-4o-mini',
          input: [
            {
              role: 'developer',
              content: developerContext,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'atlas_marketing_plan',
              description:
                'A structured multi-platform marketing plan.',
              strict: true,
              schema: MARKETING_PLAN_SCHEMA,
            },
          },
        });

      const parsed = JSON.parse(
        response.output_text,
      ) as unknown;

      return {
        ...this.normalizePlan(
          parsed,
          fallback,
        ),
        generatedBy: 'ai',
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown OpenAI error';

      console.error(
        'Marketing Planner AI generation failed:',
        message,
      );

      return {
        ...fallback,
        generatedBy: 'fallback',
        warning:
          `AI generation failed. Returned the safe fallback plan. ${message}`,
      };
    }
  }

  private normalizePlan(
    value: unknown,
    fallback: MarketingPlan,
  ): MarketingPlan {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return fallback;
    }

    const source = value as Record<
      string,
      unknown
    >;

    return {
      campaignName: this.stringValue(
        source.campaignName,
        fallback.campaignName,
      ),
      objective: this.stringValue(
        source.objective,
        fallback.objective,
      ),
      audience: this.stringValue(
        source.audience,
        fallback.audience,
      ),
      hook: this.stringValue(
        source.hook,
        fallback.hook,
      ),
      keyMessage: this.stringValue(
        source.keyMessage,
        fallback.keyMessage,
      ),
      contentPillars: this.stringArray(
        source.contentPillars,
        fallback.contentPillars,
      ),
      contentIdeas: this.stringArray(
        source.contentIdeas,
        fallback.contentIdeas,
      ),
      facebook: this.stringArray(
        source.facebook,
        fallback.facebook,
      ),
      telegram: this.stringArray(
        source.telegram,
        fallback.telegram,
      ),
      reels: this.stringArray(
        source.reels,
        fallback.reels,
      ),
      imagePrompts: this.stringArray(
        source.imagePrompts,
        fallback.imagePrompts,
      ),
      schedule: this.scheduleArray(
        source.schedule,
        fallback.schedule,
      ),
    };
  }

  private createFallbackPlan(
    prompt: string,
    audience: string,
  ): MarketingPlan {
    const topic =
      prompt ||
      'Untitled Marketing Campaign';

    return {
      campaignName: topic,
      objective:
        '提升品牌互动、内容分享与跨平台触达。',
      audience:
        audience ||
        '品牌主要目标受众',
      hook:
        `用一个有共鸣的问题开启「${topic}」，让受众主动分享自己的经历。`,
      keyMessage:
        '同一个核心主题，根据不同平台的使用习惯调整表达方式。',
      contentPillars: [
        '情感共鸣',
        '互动讨论',
        '品牌相关性',
        '短视频故事',
      ],
      contentIdeas: [
        `${topic}：你最先想到的画面是什么？`,
        '以投票形式让受众选择最有共鸣的选项。',
        '整理受众留言，制作第二篇社区回应内容。',
        '制作一个三幕式短视频故事。',
        '用一句经典对白或生活场景引起回忆。',
        '制作角色、场景或年代对比内容。',
        '邀请受众标记曾一起经历的人。',
        '制作“只有经历过的人才懂”系列。',
        '把热门留言改编成下一条内容。',
        '用总结贴收尾并预告下一系列。',
      ],
      facebook: [
        `说到「${topic}」，你脑海里第一个出现的画面是什么？留言告诉我们，也看看有没有人和你想到一样。`,
        `有些回忆，平时不会想起，但只要一个画面、一句对白，就会全部回来。关于「${topic}」，哪一幕最让你难忘？`,
        `来做个小调查：你认为「${topic}」最值得被记住的是什么？欢迎分享你的答案和原因。`,
      ],
      telegram: [
        `关于「${topic}」，你第一个想到什么？`,
        `一句话分享你对「${topic}」最深的回忆。`,
        `今天的话题：${topic}。你会选哪一个经典瞬间？`,
      ],
      reels: [
        `Hook：看到这个画面，你的回忆回来了吗？画面快速呈现3个代表性瞬间，结尾邀请观众留言。`,
        `Hook：只有经历过那个年代的人才懂。用三段递进画面建立情绪，最后提出互动问题。`,
        `Hook：你还记得第一次接触「${topic}」是什么时候吗？以第一人称回忆叙事，结尾加入自然CTA。`,
      ],
      imagePrompts: [
        `Cinematic nostalgic Malaysian Chinese social media visual inspired by "${topic}", warm emotional lighting, realistic people, premium editorial composition, subtle retro atmosphere, clear focal subject, no copyrighted logos, vertical 4:5.`,
        `Premium lifestyle campaign visual for "${topic}", Malaysian urban context, authentic Chinese audience, emotional storytelling, cinematic daylight, polished commercial photography, clean composition, no text, vertical 9:16.`,
        `Modern nostalgic poster concept for "${topic}", layered memories, warm natural tones, expressive human moment, high-end social campaign photography, realistic details, generous text-safe space, vertical 4:5.`,
      ],
      schedule: [
        {
          day: 1,
          platform: 'Facebook',
          contentType: 'Campaign launch',
          topic,
        },
        {
          day: 2,
          platform: 'Telegram',
          contentType: 'Community question',
          topic,
        },
        {
          day: 3,
          platform: 'Reels',
          contentType: 'Nostalgic short video',
          topic,
        },
        {
          day: 4,
          platform: 'Facebook',
          contentType: 'Poll',
          topic,
        },
        {
          day: 5,
          platform: 'Telegram',
          contentType: 'Comment highlight',
          topic,
        },
        {
          day: 6,
          platform: 'Reels',
          contentType: 'Audience story',
          topic,
        },
        {
          day: 7,
          platform: 'Facebook',
          contentType: 'Campaign recap',
          topic,
        },
      ],
    };
  }

  private stringValue(
    value: unknown,
    fallback: string,
  ): string {
    return typeof value === 'string' &&
      value.trim()
      ? value.trim()
      : fallback;
  }

  private stringArray(
    value: unknown,
    fallback: string[],
  ): string[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const items = value
      .filter(
        (item): item is string =>
          typeof item === 'string',
      )
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length
      ? items
      : fallback;
  }

  private scheduleArray(
    value: unknown,
    fallback: MarketingPlanScheduleItem[],
  ): MarketingPlanScheduleItem[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const items = value.flatMap(
      (
        item,
        index,
      ): MarketingPlanScheduleItem[] => {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item)
        ) {
          return [];
        }

        const source = item as Record<
          string,
          unknown
        >;

        const platform = this.stringValue(
          source.platform,
          '',
        );
        const contentType =
          this.stringValue(
            source.contentType,
            '',
          );
        const topic = this.stringValue(
          source.topic,
          '',
        );

        if (
          !platform ||
          !contentType ||
          !topic
        ) {
          return [];
        }

        const day =
          typeof source.day === 'number' &&
          Number.isFinite(source.day)
            ? Math.max(
                1,
                Math.round(source.day),
              )
            : index + 1;

        return [
          {
            day,
            platform,
            contentType,
            topic,
          },
        ];
      },
    );

    return items.length
      ? items
      : fallback;
  }

  private toText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim() || 'Not set';
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => String(item))
        .join(', ');
    }

    if (
      value === null ||
      value === undefined
    ) {
      return 'Not set';
    }

    return String(value);
  }

  private toList(value: unknown): string {
    if (!Array.isArray(value)) {
      return this.toText(value);
    }

    return value.length
      ? value
          .map((item) => String(item))
          .join(' | ')
      : 'None';
  }
}
