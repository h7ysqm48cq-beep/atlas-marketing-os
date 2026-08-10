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

  logoAssetId?: string | null;
  logoSize?: string;
  logoOpacity?: number;
  logoMargin?: number;
  logoPosition?: string;
  brandFooterEnabled?: boolean;
  brandFooterText?: string;

  footerLogoEnabled?: boolean;
  footerLogoAssetId?: string | null;

  footerQrEnabled?: boolean;
  footerQrAssetId?: string | null;
  footerQrLink?: string | null;

  footerPlacement?: string;
};

const SPORTS_NEWS_EDITABLE_KEYS = [
  'enabled',
  'timezone',
  'morningEnabled',
  'morningTime',
  'eveningEnabled',
  'eveningTime',
  'telegramEnabled',
  'telegramChannelId',
  'facebookEnabled',
  'facebookChannelId',
  'morningTelegramEnabled',
  'morningFacebookEnabled',
  'eveningTelegramEnabled',
  'eveningFacebookEnabled',
  'autoPublishEnabled',
  'approvalRequired',
  'language',
  'sportsKnowledgeEnabled',
  'discussionQuestionEnabled',
  'referenceLinksEnabled',
  'sameDaySourcesOnly',
  'maxSourceAgeHours',
  'requirePublishedAt',
  'requireSourceUrl',
  'minimumSources',
  'freshnessFallbackEnabled',
  'customPromptEnabled',
  'systemPrompt',
  'morningPrompt',
  'eveningPrompt',
  'knowledgePrompt',
  'customInstructions',
  'imageEnabled',
  'imagePrompt',
  'morningImagePrompt',
  'eveningImagePrompt',
  'imageAspectRatio',
  'imageTextMode',
  'imageVisualStyle',
  'logoEnabled',
  'logoAssetId',
  'logoSize',
  'logoOpacity',
  'logoMargin',
  'logoPosition',
  'brandFooterEnabled',
  'brandFooterText',
  'footerLogoEnabled',
  'footerLogoAssetId',
  'footerQrEnabled',
  'footerQrAssetId',
  'footerQrLink',
  'footerPlacement',
] as const satisfies readonly (keyof UpdateSportsNewsSettingsInput)[];

@Injectable()
export class SportsNewsSettingsService {
  constructor(private readonly prisma: PrismaService) {}
  private async workspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    return workspace;
  }
  async get() {
    const workspace = await this.workspace();
    return this.prisma.sportsNewsSetting.upsert({
      where: { workspaceId: workspace.id },
      update: {},
      create: { workspaceId: workspace.id },
      include: {
        telegramChannel: {
          select: {
            id: true,
            platform: true,
            name: true,
            username: true,
            externalId: true,
            status: true,
            lastConnectedAt: true,
            lastError: true,
          },
        },
        facebookChannel: {
          select: {
            id: true,
            platform: true,
            name: true,
            username: true,
            externalId: true,
            status: true,
            lastConnectedAt: true,
            lastError: true,
          },
        },
      },
    });
  }
  async update(input: UpdateSportsNewsSettingsInput) {
    const settings = await this.get();
    if (input.morningTime) this.validateTime(input.morningTime, 'morningTime');
    if (input.eveningTime) this.validateTime(input.eveningTime, 'eveningTime');
    if (
      input.maxSourceAgeHours !== undefined &&
      (input.maxSourceAgeHours < 1 || input.maxSourceAgeHours > 168)
    )
      throw new BadRequestException(
        'maxSourceAgeHours must be between 1 and 168.',
      );
    if (
      input.minimumSources !== undefined &&
      (input.minimumSources < 1 || input.minimumSources > 20)
    )
      throw new BadRequestException('minimumSources must be between 1 and 20.');
    if (input.telegramChannelId)
      await this.validateChannel(
        input.telegramChannelId,
        SocialPlatform.TELEGRAM,
      );
    if (input.facebookChannelId)
      await this.validateChannel(
        input.facebookChannelId,
        SocialPlatform.FACEBOOK,
      );
    const data = Object.fromEntries(
      SPORTS_NEWS_EDITABLE_KEYS.filter((key) =>
        Object.prototype.hasOwnProperty.call(input, key),
      ).map((key) => [key, input[key]]),
    ) as UpdateSportsNewsSettingsInput;

    return this.prisma.sportsNewsSetting.update({
      where: { id: settings.id },
      data,
      include: {
        telegramChannel: {
          select: {
            id: true,
            platform: true,
            name: true,
            username: true,
            externalId: true,
            status: true,
            lastConnectedAt: true,
            lastError: true,
          },
        },
        facebookChannel: {
          select: {
            id: true,
            platform: true,
            name: true,
            username: true,
            externalId: true,
            status: true,
            lastConnectedAt: true,
            lastError: true,
          },
        },
      },
    });
  }
  async channels() {
    const workspace = await this.workspace();
    return this.prisma.socialChannel.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        platform: true,
        name: true,
        username: true,
        externalId: true,
        status: true,
        lastError: true,
      },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });
  }
  async markRun(
    kind: 'morning' | 'evening',
    status: string,
    error?: string | null,
  ) {
    const settings = await this.get();
    return this.prisma.sportsNewsSetting.update({
      where: { id: settings.id },
      data: {
        ...(kind === 'morning'
          ? { lastMorningRunAt: new Date() }
          : { lastEveningRunAt: new Date() }),
        lastRunStatus: status,
        lastError: error ?? null,
      },
    });
  }
  private validateTime(value: string, field: string) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new BadRequestException(
        `${field} must use HH:mm (24-hour) format.`,
      );
  }
  private async validateChannel(id: string, platform: SocialPlatform) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: { id },
    });
    if (!channel) throw new NotFoundException('Social channel not found.');
    if (channel.platform !== platform)
      throw new BadRequestException(`Selected channel must be ${platform}.`);
  }
}
