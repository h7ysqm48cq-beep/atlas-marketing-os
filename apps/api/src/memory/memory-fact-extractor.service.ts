import { Injectable } from '@nestjs/common';
import {
  BrandMemoryFact,
  BrandMemoryFactStatus,
  BrandMemoryFactType,
} from '../generated/prisma/client';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';

export type DetectedMemoryFact = {
  type: BrandMemoryFactType;
  key: string;
  value: string;
  description: string;
  confidence: number;
};

type ExtractMemoryInput = {
  message: string;
  sourceId?: string;
  conversationId?: string;
};

@Injectable()
export class MemoryFactExtractorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
  ) {}

  async extractFromMessage(input: ExtractMemoryInput) {
    const candidates = this.detectCandidates(input.message);

    if (!candidates.length) {
      return [];
    }

    const brand = await this.brands.getActiveBrand();

    const saved: Awaited<
      ReturnType<PrismaService['brandMemoryFact']['findFirst']>
    >[] = [];

    for (const candidate of candidates) {
      const existingFacts = await this.prisma.brandMemoryFact.findMany({
        where: {
          brandId: brand.id,
          key: {
            equals: candidate.key,
            mode: 'insensitive',
          },
          status: {
            in: [
              BrandMemoryFactStatus.CANDIDATE,
              BrandMemoryFactStatus.CONFIRMED,
            ],
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      const sameValue = existingFacts.find(
        (fact) =>
          this.normalizeValue(fact.value) ===
          this.normalizeValue(candidate.value),
      );

      if (sameValue) {
        saved.push(sameValue);
        continue;
      }

      const existingCandidate = existingFacts.find(
        (fact) => fact.status === BrandMemoryFactStatus.CANDIDATE,
      );

      if (existingCandidate) {
        const nextConfidence = Math.min(existingCandidate.confidence + 5, 100);

        const updated = await this.prisma.brandMemoryFact.update({
          where: {
            id: existingCandidate.id,
          },
          data: {
            type: candidate.type,
            value: candidate.value,
            description: candidate.description,

            confidence: Math.max(nextConfidence, candidate.confidence),

            status:
              nextConfidence >= 100
                ? BrandMemoryFactStatus.CONFIRMED
                : BrandMemoryFactStatus.CANDIDATE,

            sourceType: 'conversation-rule',

            sourceId:
              input.sourceId ||
              input.conversationId ||
              existingCandidate.sourceId,
          },
        });

        saved.push(updated);
        continue;
      }

      const created = await this.prisma.brandMemoryFact.create({
        data: {
          brandId: brand.id,
          type: candidate.type,
          key: candidate.key,
          value: candidate.value,
          description: candidate.description,
          confidence: candidate.confidence,
          status: BrandMemoryFactStatus.CANDIDATE,
          sourceType: 'conversation-rule',
          sourceId: input.sourceId || input.conversationId || null,
        },
      });

      saved.push(created);
    }

    return saved;
  }

  detectCandidates(rawMessage: string): DetectedMemoryFact[] {
    const message = rawMessage.replace(/\s+/g, ' ').trim();

    if (!message || !this.hasLongTermIntent(message)) {
      return [];
    }

    const facts: DetectedMemoryFact[] = [];

    const add = (fact: DetectedMemoryFact) => {
      const duplicate = facts.some(
        (item) =>
          item.key === fact.key &&
          this.normalizeValue(item.value) === this.normalizeValue(fact.value),
      );

      if (!duplicate) {
        facts.push(fact);
      }
    };

    // Language preferences
    if (
      /简体(?:中文|字)?|simplified chinese/i.test(message) ||
      /不要再?(?:用|写)?繁体|不用繁体/.test(message)
    ) {
      add({
        type: BrandMemoryFactType.PREFERENCE,
        key: 'default_language',
        value: 'Simplified Chinese',
        description: 'Use Simplified Chinese as the default written language.',
        confidence: 96,
      });
    }

    if (
      /繁体(?:中文|字)?|traditional chinese/i.test(message) &&
      !/不要|不用|避免/.test(message)
    ) {
      add({
        type: BrandMemoryFactType.PREFERENCE,
        key: 'default_language',
        value: 'Traditional Chinese',
        description: 'Use Traditional Chinese as the default written language.',
        confidence: 94,
      });
    }

    if (
      /(?:全部|都|默认|以后).{0,10}(?:用|写)?英文|english only|always use english/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.PREFERENCE,
        key: 'default_language',
        value: 'English',
        description: 'Use English as the default written language.',
        confidence: 95,
      });
    }

    if (/马来文|马来语|bahasa malaysia|bahasa melayu/i.test(message)) {
      add({
        type: BrandMemoryFactType.PREFERENCE,
        key: 'default_language',
        value: 'Bahasa Malaysia',
        description: 'Use Bahasa Malaysia as the default written language.',
        confidence: 92,
      });
    }

    // Long-term visual preferences

    if (
      /logo.{0,20}(小|小一点|不要太大|低调|subtle|small)|品牌标识.{0,20}(小|低调)/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'logo_placement',
        value: 'Keep logo subtle and small',
        description: 'Use a small and unobtrusive logo placement in visuals.',
        confidence: 96,
      });
    }

    if (
      /不要太广告|avoid hard sell|不要硬广|自然一点|像生活内容/i.test(message)
    ) {
      add({
        type: BrandMemoryFactType.CONTENT,
        key: 'content_style',
        value: 'Natural soft-sell content style',
        description:
          'Prefer relatable content instead of aggressive advertising.',
        confidence: 94,
      });
    }

    if (
      /马来西亚华人|malaysian chinese|本地文化|local context/i.test(message)
    ) {
      add({
        type: BrandMemoryFactType.AUDIENCE,
        key: 'market_context',
        value: 'Malaysian Chinese cultural context',
        description:
          'Consider Malaysian Chinese cultural context in content creation.',
        confidence: 94,
      });
    }

    if (/文字不要太多|少文字|简化重点|重点内容|short text/i.test(message)) {
      add({
        type: BrandMemoryFactType.CONTENT,
        key: 'visual_copy_length',
        value: 'Keep visual text concise',
        description: 'Prefer short, clear visual copy with strong hierarchy.',
        confidence: 95,
      });
    }

    if (/明亮|bright|鲜艳|颜色好看|暖色/i.test(message)) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'color_direction',
        value: 'Prefer bright premium visual tone',
        description: 'Prefer brighter and visually appealing color direction.',
        confidence: 90,
      });
    }

    // Visual style
    if (/电影感|cinematic/i.test(message)) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'default_image_style',
        value: 'Cinematic',
        description: 'Use a cinematic visual style by default.',
        confidence: 94,
      });
    }

    if (/写实|真实摄影|photorealistic|photo realistic/i.test(message)) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'default_image_style',
        value: 'Photorealistic',
        description: 'Use realistic photographic visuals by default.',
        confidence: 93,
      });
    }

    if (/极简|minimal(?:ist)?/i.test(message)) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'default_image_style',
        value: 'Minimal',
        description: 'Prefer a clean and minimal visual style.',
        confidence: 90,
      });
    }

    if (/(?:3D|三维|立体风格)/i.test(message)) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'default_image_style',
        value: '3D',
        description: 'Use a 3D visual style by default.',
        confidence: 88,
      });
    }

    // Logo preferences
    if (
      /(?:logo|品牌|品牌字眼).{0,10}(?:小一点|放小|保持小|不要太大)/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'logo_size',
        value: 'Small',
        description:
          'Keep the brand logo relatively small so it does not overpower the content.',
        confidence: 96,
      });
    }

    if (
      /(?:logo|品牌|品牌字眼).{0,12}(?:底部中间|底部中央|下方中央|bottom center)/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.VISUAL,
        key: 'logo_position',
        value: 'Bottom center',
        description: 'Place the brand logo at the bottom center by default.',
        confidence: 96,
      });
    }

    if (/(?:不要|不放|移除|隐藏).{0,8}(?:logo|品牌标志)/i.test(message)) {
      add({
        type: BrandMemoryFactType.AVOIDANCE,
        key: 'logo_visibility',
        value: 'Hidden',
        description:
          'Do not include a logo unless the user explicitly requests it.',
        confidence: 93,
      });
    }

    // Market
    if (
      /malaysia only|只做大马|只做马来西亚|仅限马来西亚|马来西亚市场/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.AUDIENCE,
        key: 'target_market',
        value: 'Malaysia',
        description: 'Prioritise the Malaysia market.',
        confidence: 96,
      });
    }

    if (/singapore only|只做新加坡|仅限新加坡/i.test(message)) {
      add({
        type: BrandMemoryFactType.AUDIENCE,
        key: 'target_market',
        value: 'Singapore',
        description: 'Prioritise the Singapore market.',
        confidence: 95,
      });
    }

    // Tone and promotion style
    if (
      /不要太广告|不要太像广告|弱化广告|soft sell|不硬销|不要硬销/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.VOICE,
        key: 'promotion_tone',
        value: 'Soft-sell',
        description:
          'Keep promotional language natural and avoid an overly sales-driven tone.',
        confidence: 96,
      });
    }

    if (/搞笑|幽默|funny|humorous/i.test(message)) {
      add({
        type: BrandMemoryFactType.VOICE,
        key: 'preferred_tone',
        value: 'Humorous',
        description: 'Prefer a humorous and conversational tone when suitable.',
        confidence: 88,
      });
    }

    if (/专业|professional/i.test(message)) {
      add({
        type: BrandMemoryFactType.VOICE,
        key: 'preferred_tone',
        value: 'Professional',
        description: 'Prefer a professional tone when suitable.',
        confidence: 87,
      });
    }

    if (/温暖|温馨|warm|heartwarming/i.test(message)) {
      add({
        type: BrandMemoryFactType.VOICE,
        key: 'preferred_tone',
        value: 'Warm',
        description: 'Prefer a warm and emotionally relatable tone.',
        confidence: 88,
      });
    }

    // Avoidance rules
    if (
      /不要.{0,12}(?:赌博|博彩|betting|gambling)(?:字眼|内容|词)?/i.test(
        message,
      )
    ) {
      add({
        type: BrandMemoryFactType.AVOIDANCE,
        key: 'avoid_gambling_wording',
        value: 'Avoid gambling-related wording',
        description:
          'Avoid explicit gambling-related wording unless required by the current task.',
        confidence: 97,
      });
    }

    if (/不要.{0,10}(?:bonus|free|免费|红利|奖金)(?:字眼|词)?/i.test(message)) {
      add({
        type: BrandMemoryFactType.AVOIDANCE,
        key: 'avoid_bonus_wording',
        value: 'Avoid bonus and free-offer wording',
        description:
          'Avoid bonus, free-offer and similar promotional wording unless explicitly requested.',
        confidence: 94,
      });
    }

    return facts;
  }

  private hasLongTermIntent(message: string) {
    return [
      /以后/,
      /今后/,
      /从现在开始/,
      /每次/,
      /默认/,
      /一律/,
      /永远/,
      /全部/,
      /都要/,
      /都用/,
      /不要再/,
      /以后不要/,
      /我喜欢/,
      /我偏好/,
      /我不喜欢/,
      /always/i,
      /going forward/i,
      /from now on/i,
      /by default/i,
      /every time/i,
      /only$/i,
      /only\b/i,
    ].some((pattern) => pattern.test(message));
  }

  private normalizeValue(value: string) {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
