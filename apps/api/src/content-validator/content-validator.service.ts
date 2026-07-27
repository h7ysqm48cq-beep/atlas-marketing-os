import { Injectable } from '@nestjs/common';
import type { AIContext } from '../context/context.types';
import type {
  StructuredMarketingOutput,
} from '../prompt-builder/prompt-builder.types';
import type {
  ContentValidationResult,
  ValidationIssue,
} from './content-validator.types';

@Injectable()
export class ContentValidatorService {
  status() {
    return {
      validator: 'content',
      status: 'ready',
    };
  }

  validate(
    output: StructuredMarketingOutput,
    context: AIContext,
  ): ContentValidationResult {
    const issues: ValidationIssue[] = [];

    const addIssue = (
      code: string,
      severity: 'error' | 'warning',
      field: string,
      message: string,
    ) => {
      issues.push({
        code,
        severity,
        field,
        message,
      });
    };

    const requiredTextFields = [
      ['title', output.title],
      ['hook', output.hook],
      ['facebook.caption', output.facebook?.caption],
      [
        'facebook.discussionQuestion',
        output.facebook?.discussionQuestion,
      ],
      ['telegram.message', output.telegram?.message],
      [
        'telegram.callToAction',
        output.telegram?.callToAction,
      ],
      ['reels.title', output.reels?.title],
      ['reels.caption', output.reels?.caption],
      ['imagePrompt', output.imagePrompt],
    ] as const;

    for (const [field, value] of requiredTextFields) {
      if (
        typeof value !== 'string' ||
        value.trim().length === 0
      ) {
        addIssue(
          'REQUIRED_FIELD_MISSING',
          'error',
          field,
          `${field} is required.`,
        );
      }
    }

    if (
      !Array.isArray(output.reels?.scenes) ||
      output.reels.scenes.length === 0
    ) {
      addIssue(
        'REELS_SCENES_MISSING',
        'error',
        'reels.scenes',
        'At least one Reels scene is required.',
      );
    } else {
      output.reels.scenes.forEach(
        (scene, index) => {
          if (
            !scene.visual?.trim() ||
            !scene.onScreenText?.trim() ||
            !scene.voiceover?.trim()
          ) {
            addIssue(
              'REELS_SCENE_INCOMPLETE',
              'error',
              `reels.scenes.${index}`,
              'Every Reels scene must include visual, onScreenText and voiceover.',
            );
          }
        },
      );
    }

    const searchableText = [
      output.title,
      output.hook,
      output.facebook?.caption,
      output.facebook?.discussionQuestion,
      output.telegram?.message,
      output.telegram?.callToAction,
      output.reels?.title,
      output.reels?.caption,
      ...(output.reels?.scenes ?? []).flatMap(
        (scene) => [
          scene.visual,
          scene.onScreenText,
          scene.voiceover,
        ],
      ),
      output.imagePrompt,
      ...(output.hashtags ?? []),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    for (
      const forbiddenWord
      of context.brand.forbiddenWords
    ) {
      if (
        forbiddenWord.trim() &&
        searchableText.includes(
          forbiddenWord.toLowerCase(),
        )
      ) {
        addIssue(
          'FORBIDDEN_WORD_FOUND',
          'error',
          'content',
          `Forbidden term found: ${forbiddenWord}`,
        );
      }
    }

    if (
      searchableText.includes(
        'mgmbetmyr.com',
      )
    ) {
      addIssue(
        'WEBSITE_LINK_FOUND',
        'error',
        'content',
        'The website domain must not appear in generated content.',
      );
    }

    const hashtagText =
      (output.hashtags ?? [])
        .join(' ')
        .toLowerCase();

    if (
      !hashtagText.includes('#满贯门') &&
      !searchableText.includes('#满贯门')
    ) {
      addIssue(
        'BRAND_HASHTAG_MISSING',
        'warning',
        'hashtags',
        'The required #满贯门 hashtag is missing.',
      );
    }

    const telegramText = [
      output.telegram?.message,
      output.telegram?.callToAction,
    ]
      .filter(Boolean)
      .join(' ');

    if (
      !telegramText.includes(
        'https://t.me/mgmbetmyrgroup',
      )
    ) {
      addIssue(
        'TELEGRAM_LINK_MISSING',
        'warning',
        'telegram.callToAction',
        'The approved Telegram group link is missing.',
      );
    }

    const errorCount =
      issues.filter(
        (issue) =>
          issue.severity === 'error',
      ).length;

    const warningCount =
      issues.filter(
        (issue) =>
          issue.severity === 'warning',
      ).length;

    const score = Math.max(
      0,
      100 -
        errorCount * 20 -
        warningCount * 5,
    );

    return {
      valid: errorCount === 0,
      score,
      issues,
    };
  }
}
