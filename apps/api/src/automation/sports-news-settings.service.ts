import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SocialPlatform } from '../generated/prisma/enums';

export type UpdateSportsNewsSettingsInput = {
  enabled?: boolean;
  timezone?: string;

  morningEnabled?: boolean;
  morningTime?: string;

  eveningEnabled?: boolean;
  eveningTime?: string;

  telegramEnabled?: boolean;
  telegramChannelId?: string | null;

  facebookEnabled?: boolean;
  facebookChannelId?: string | null;

  morningTelegramEnabled?: boolean;
  morningFacebookEnabled?: boolean;
  eveningTelegramEnabled?: boolean;
  eveningFacebookEnabled?: boolean;

  autoPublishEnabled?: boolean;
  approvalRequired?: boolean;

  language?: string;

  sportsKnowledgeEnabled?: boolean;
  discussionQuestionEnabled?: boolean;
  referenceLinksEnabled?: boolean;

  sameDaySourcesOnly?: boolean;
  maxSourceAgeHours?: number;
  requirePublishedAt?: boolean;
  requireSourceUrl?: boolean;
  minimumSources?: number;
  freshnessFallbackEnabled?: boolean;

  customPromptEnabled?: boolean;
  systemPrompt?: string | null;
  morningPrompt?: string | null;
  eveningPrompt?: string | null;
  knowledgePrompt?: string | null;
  customInstructions?: string | null;

  imageEnabled?: boolean;
  imagePrompt?: string | null;
  morningImagePrompt?: string | null;
  eveningImagePrompt?: string | null;
  imageAspectRatio?: string;
  imageTextMode?: string;
  imageVisualStyle?: string | null;

  logoEnabled?: boolean;
  logoPosition?: string;

  brandFooterEnabled?: boolean;
  brandFooterText?: string;

  storyMinimum?: number;
  storyMaximum?: number;
  sportsPriority?: string;

  verificationInstructions?: string | null;
  imageHeadlineInstructions?: string | null;
  visibleCopyInstructions?: string | null;

  telegramMorningHeader?: string;
  telegramEveningHeader?: string;
  telegramSectionLabel?: string;

  telegramCtaEnabled?: boolean;
  telegramCtaText?: string;
  telegramCtaUrl?: string;

  telegramShowSummaries?: boolean;
  telegramCaptionTarget?: number;

  telegramSummaryZhLong?: number;
  telegramSummaryEnLong?: number;
  telegramSummaryZhMedium?: number;
  telegramSummaryEnMedium?: number;
  telegramSummaryZhShort?: number;
  telegramSummaryEnShort?: number;
  telegramSummaryZhCompact?: number;
  telegramSummaryEnCompact?: number;

  visualDirectorEnabled?: boolean;
  visualDirectorPrompt?: string | null;

  heroStoryWeight?: number;

  singleSportVisualPrompt?: string | null;
  multiSportVisualPrompt?: string | null;

  completedEventVisualPrompt?: string | null;
  upcomingEventVisualPrompt?: string | null;
  developmentVisualPrompt?: string | null;

  morningVisualDirection?: string | null;
  eveningVisualDirection?: string | null;

  imagePhotographyPrompt?: string | null;
  imageNegativePrompt?: string | null;

  imageUpperSafeAreaPrompt?: string | null;
  imageLowerSafeAreaPrompt?: string | null;

  imageLayoutEnabled?: boolean;

  mastheadScale?: number;
  mastheadTopPercent?: number;

  highlightsPanelWidthPercent?: number;
  highlightsPanelHeightPercent?: number;
  highlightsPanelTopPercent?: number;
  highlightsPanelOpacityStart?: number;
  highlightsPanelOpacityMiddle?: number;
  highlightsPanelOpacityEnd?: number;
  highlightsPanelRadius?: number;

  heroHeadlineScale?: number;
  secondaryHeadlineScale?: number;

  story02PositionPercent?: number;
  story03PositionPercent?: number;

  footerHeightPercent?: number;

  qrEnabled?: boolean;
  qrLink?: string;

  mastheadBrandText?: string;

  morningEditionZh?: string;
  eveningEditionZh?: string;
  morningEditionEn?: string;
  eveningEditionEn?: string;

  imageSectionLabel?: string;

  morningAccentColor?: string;
  eveningAccentColor?: string;
  morningSecondaryColor?: string;
  eveningSecondaryColor?: string;

  mastheadPrimaryColor?: string;
  mastheadEnglishColor?: string;
  headlinePrimaryColor?: string;
  headlineSecondaryColor?: string;
  panelBaseColor?: string;

  watermarkEnabled?: boolean;
  watermarkScale?: number;
  watermarkOpacity?: number;
  watermarkPosition?: string;

  qrSizePercent?: number;
  qrMarginPercent?: number;

  footerDateEnabled?: boolean;
  footerDateSeparator?: string;
  footerBackgroundColor?: string;
  footerSeparatorColor?: string;

  imageGenerationSize?: string;
  imageGenerationQuality?: string;

  footballKeywords?: string;
  basketballKeywords?: string;
  motorsportKeywords?: string;
  motorcycleKeywords?: string;
  tennisKeywords?: string;
  badmintonKeywords?: string;
  baseballKeywords?: string;
  combatKeywords?: string;

  completedScoreRequired?: boolean;
  invalidStoryPolicy?: string;
  morningSameDaySourcesOnly?: boolean;

  newsAiModel?: string;
  newsWebSearchEnabled?: boolean;

  imageAiModel?: string | null;
  imageGenerationEnabled?: boolean;

  duplicateEditionPolicy?: string;
  forceRunExistingPolicy?: string;
  queueStatusOnCreate?: string;

  publishRetryEnabled?: boolean;
  publishRetryLimit?: number;
  publishRetryDelayMinutes?: number;

  generationFailurePolicy?: string;
  imageFailurePolicy?: string;
  brandingFailurePolicy?: string;

  minimumSourcesPerStory?: number;
  minimumStoriesPerEdition?: number;

  completedEventPolicy?: string;
  upcomingEventPolicy?: string;
  developmentStoryPolicy?: string;

  sourceDeduplicationEnabled?: boolean;

  imageRulesEnabled?: boolean;
  imageRulesPrompt?: string | null;

  imageBrandRulesEnabled?: boolean;
  imageBrandRulesPrompt?: string | null;

  forceRunEnabled?: boolean;
  forceMorningEnabled?: boolean;
  forceEveningEnabled?: boolean;

  morningPostTitleTemplate?: string;
  eveningPostTitleTemplate?: string;

  imageModelOverrideEnabled?: boolean;

  previewNewsPromptEnabled?: boolean;
  previewImagePromptEnabled?: boolean;
  previewTelegramCaptionEnabled?: boolean;

  recommendedDefaultsVersion?: string;
};

@Injectable()
export class SportsNewsSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async workspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }

    return workspace;
  }

  async get() {
    const workspace = await this.workspace();

    return this.prisma.sportsNewsSetting.upsert({
      where: {
        workspaceId: workspace.id,
      },
      update: {},
      create: {
        workspaceId: workspace.id,
      },
      include: {
        telegramChannel: true,
        facebookChannel: true,
      },
    });
  }

  async update(input: UpdateSportsNewsSettingsInput) {
    const settings = await this.get();

    /*
     * Runtime API boundary protection.
     *
     * UpdateSportsNewsSettingsInput is a TypeScript type, so arbitrary
     * JSON properties can still exist at runtime. Build the editable
     * allowlist from the actual persisted SportsNewsSetting fields and
     * explicitly remove system metadata, runtime status and expanded
     * relations before Prisma receives the update payload.
     */
    const readOnlyFields = new Set([
      'id',
      'workspaceId',
      'workspace',
      'telegramChannel',
      'facebookChannel',
      'createdAt',
      'updatedAt',
      'lastMorningRunAt',
      'lastEveningRunAt',
      'lastRunStatus',
      'lastError',
    ]);

    const editableFields = new Set(
      Object.keys(settings).filter((key) => !readOnlyFields.has(key)),
    );

    const sanitizedInput = Object.fromEntries(
      Object.entries(input as Record<string, unknown>).filter(([key]) =>
        editableFields.has(key),
      ),
    ) as UpdateSportsNewsSettingsInput;

    if (sanitizedInput.morningTime) {
      this.validateTime(sanitizedInput.morningTime, 'morningTime');
    }

    if (sanitizedInput.eveningTime) {
      this.validateTime(sanitizedInput.eveningTime, 'eveningTime');
    }

    if (
      sanitizedInput.maxSourceAgeHours !== undefined &&
      (sanitizedInput.maxSourceAgeHours < 1 ||
        sanitizedInput.maxSourceAgeHours > 168)
    ) {
      throw new BadRequestException(
        'maxSourceAgeHours must be between 1 and 168.',
      );
    }

    if (
      sanitizedInput.minimumSources !== undefined &&
      (sanitizedInput.minimumSources < 1 || sanitizedInput.minimumSources > 20)
    ) {
      throw new BadRequestException('minimumSources must be between 1 and 20.');
    }

    const nextStoryMinimum =
      sanitizedInput.storyMinimum ?? settings.storyMinimum;

    const nextStoryMaximum =
      sanitizedInput.storyMaximum ?? settings.storyMaximum;

    if (
      nextStoryMinimum < 1 ||
      nextStoryMinimum > 10 ||
      nextStoryMaximum < 1 ||
      nextStoryMaximum > 10 ||
      nextStoryMinimum > nextStoryMaximum
    ) {
      throw new BadRequestException(
        'storyMinimum/storyMaximum must be between 1 and 10 and minimum cannot exceed maximum.',
      );
    }

    if (
      sanitizedInput.telegramCaptionTarget !== undefined &&
      (sanitizedInput.telegramCaptionTarget < 300 ||
        sanitizedInput.telegramCaptionTarget > 1000)
    ) {
      throw new BadRequestException(
        'telegramCaptionTarget must be between 300 and 1000.',
      );
    }

    if (
      sanitizedInput.heroStoryWeight !== undefined &&
      (sanitizedInput.heroStoryWeight < 20 ||
        sanitizedInput.heroStoryWeight > 90)
    ) {
      throw new BadRequestException(
        'heroStoryWeight must be between 20 and 90.',
      );
    }

    const percentageFields = [
      ['mastheadTopPercent', sanitizedInput.mastheadTopPercent],
      [
        'highlightsPanelWidthPercent',
        sanitizedInput.highlightsPanelWidthPercent,
      ],
      [
        'highlightsPanelHeightPercent',
        sanitizedInput.highlightsPanelHeightPercent,
      ],
      ['highlightsPanelTopPercent', sanitizedInput.highlightsPanelTopPercent],
      [
        'highlightsPanelOpacityStart',
        sanitizedInput.highlightsPanelOpacityStart,
      ],
      [
        'highlightsPanelOpacityMiddle',
        sanitizedInput.highlightsPanelOpacityMiddle,
      ],
      ['highlightsPanelOpacityEnd', sanitizedInput.highlightsPanelOpacityEnd],
      ['story02PositionPercent', sanitizedInput.story02PositionPercent],
      ['story03PositionPercent', sanitizedInput.story03PositionPercent],
      ['footerHeightPercent', sanitizedInput.footerHeightPercent],
    ] as const;

    for (const [field, value] of percentageFields) {
      if (value !== undefined && (value < 0 || value > 1)) {
        throw new BadRequestException(`${field} must be between 0 and 1.`);
      }
    }

    const positiveFields = [
      ['mastheadScale', sanitizedInput.mastheadScale],
      ['heroHeadlineScale', sanitizedInput.heroHeadlineScale],
      ['secondaryHeadlineScale', sanitizedInput.secondaryHeadlineScale],
    ] as const;

    for (const [field, value] of positiveFields) {
      if (value !== undefined && (value <= 0 || value > 3)) {
        throw new BadRequestException(
          `${field} must be greater than 0 and no more than 3.`,
        );
      }
    }

    const summaryFields = [
      sanitizedInput.telegramSummaryZhLong,
      sanitizedInput.telegramSummaryEnLong,
      sanitizedInput.telegramSummaryZhMedium,
      sanitizedInput.telegramSummaryEnMedium,
      sanitizedInput.telegramSummaryZhShort,
      sanitizedInput.telegramSummaryEnShort,
      sanitizedInput.telegramSummaryZhCompact,
      sanitizedInput.telegramSummaryEnCompact,
    ];

    if (
      summaryFields.some(
        (value) => value !== undefined && (value < 0 || value > 300),
      )
    ) {
      throw new BadRequestException(
        'Telegram summary budgets must be between 0 and 300.',
      );
    }

    if (sanitizedInput.telegramChannelId) {
      await this.validateChannel(
        sanitizedInput.telegramChannelId,
        SocialPlatform.TELEGRAM,
      );
    }

    if (sanitizedInput.facebookChannelId) {
      await this.validateChannel(
        sanitizedInput.facebookChannelId,
        SocialPlatform.FACEBOOK,
      );
    }

    return this.prisma.sportsNewsSetting.update({
      where: {
        id: settings.id,
      },
      data: sanitizedInput,
      include: {
        telegramChannel: true,
        facebookChannel: true,
      },
    });
  }

  async channels() {
    const workspace = await this.workspace();

    return this.prisma.socialChannel.findMany({
      where: {
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        platform: true,
        name: true,
        username: true,
        externalId: true,
        status: true,
        lastError: true,
      },
      orderBy: [
        {
          platform: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  private validateTime(value: string, field: string) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new BadRequestException(
        `${field} must use HH:mm (24-hour) format.`,
      );
    }
  }

  private async validateChannel(id: string, platform: SocialPlatform) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: {
        id,
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }

    if (channel.platform !== platform) {
      throw new BadRequestException(`Selected channel must be ${platform}.`);
    }
  }
}
