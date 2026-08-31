import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuthContextService } from '../auth/auth-context.service';
import { PrismaService } from '../database/prisma.service';
import { ScheduledPostStatus } from '../generated/prisma/enums';
import { SocialTokenCryptoService } from '../common/social-token-crypto.service';
import { AutomationService } from './automation.service';
import { PublisherService } from './publisher.service';
import { FacebookConnectorService } from './facebook-connector.service';
import { TelegramConnectorService } from './telegram-connector.service';
import { InstagramConnectorService } from './instagram-connector.service';
import { RuntimeProfileService } from './runtime-profile.service';
import { BrowserRuntimeBridgeService } from './browser-runtime-bridge.service';

@Injectable()
export class WorkspaceScopedAutomationService extends AutomationService {
  constructor(
    private readonly scopedPrisma: PrismaService,
    publisher: PublisherService,
    socialTokenCrypto: SocialTokenCryptoService,
    facebookConnector: FacebookConnectorService,
    telegramConnector: TelegramConnectorService,
    runtimeProfiles: RuntimeProfileService,
    private readonly authContext: AuthContextService,
    @Optional()
    instagramConnector?: InstagramConnectorService,
    @Optional()
    browserRuntime?: BrowserRuntimeBridgeService,
  ) {
    super(
      scopedPrisma,
      publisher,
      socialTokenCrypto,
      facebookConnector,
      telegramConnector,
      runtimeProfiles,
      instagramConnector,
      browserRuntime,
    );
  }

  private async requestWorkspaceId(): Promise<string | null> {
    const userId = this.authContext.getUserId();

    if (!userId) {
      return null;
    }

    const workspace = await this.scopedPrisma.workspace.findUnique({
      where: { ownerUserId: userId },
      select: { id: true },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace ownership is not configured.');
    }

    return workspace.id;
  }

  private async assertBrand(workspaceId: string, brandId: string) {
    const brand = await this.scopedPrisma.brand.findFirst({
      where: { id: brandId, workspaceId },
      select: { id: true },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found.');
    }
  }

  private async assertChannel(
    workspaceId: string,
    channelId: string,
    brandId?: string,
  ) {
    const channel = await this.scopedPrisma.socialChannel.findFirst({
      where: {
        id: channelId,
        workspaceId,
        ...(brandId ? { brandId } : {}),
      },
      select: { id: true },
    });

    if (!channel) {
      throw new NotFoundException('Social channel not found.');
    }
  }

  private validateScheduledTime(status: ScheduledPostStatus, scheduledAt: Date) {
    if (
      status === ScheduledPostStatus.SCHEDULED &&
      scheduledAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'Scheduled posts must use a future scheduledAt value.',
      );
    }
  }

  private buildScheduledAtRange(from?: string, to?: string) {
    const scheduledAt: { gte?: Date; lt?: Date } = {};

    if (from) {
      const parsedFrom = new Date(from);
      if (!Number.isNaN(parsedFrom.getTime())) {
        scheduledAt.gte = parsedFrom;
      }
    }

    if (to) {
      const parsedTo = new Date(to);
      if (!Number.isNaN(parsedTo.getTime())) {
        scheduledAt.lt = parsedTo;
      }
    }

    return scheduledAt;
  }

  private safePostLimit(limit?: number) {
    const requestedLimit =
      Number.isFinite(limit) && Number(limit) > 0
        ? Math.floor(Number(limit))
        : 300;

    return Math.min(requestedLimit, 500);
  }

  override async listChannels(includeHidden = false) {
    const workspaceId = await this.requestWorkspaceId();

    if (!workspaceId) {
      return super.listChannels(includeHidden);
    }

    const channels = await super.listChannels(includeHidden);

    return channels.filter(
      (channel) =>
        (channel as { workspaceId?: string }).workspaceId === workspaceId,
    );
  }

  override async listCalendarPosts(
    status?: ScheduledPostStatus,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const workspaceId = await this.requestWorkspaceId();

    if (!workspaceId) {
      return super.listCalendarPosts(status, from, to, limit);
    }

    const scheduledAt = this.buildScheduledAtRange(from, to);
    const posts = await this.scopedPrisma.scheduledPost.findMany({
      where: {
        brand: { workspaceId },
        channel: {
          workspaceId,
          hiddenAt: null,
        },
        ...(status ? { status } : {}),
        ...(Object.keys(scheduledAt).length ? { scheduledAt } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: this.safePostLimit(limit),
      select: {
        id: true,
        brandId: true,
        channelId: true,
        campaignId: true,
        historyId: true,
        platform: true,
        title: true,
        content: true,
        mediaUrls: true,
        scheduledAt: true,
        timezone: true,
        status: true,
        publishedAt: true,
        externalPostId: true,
        externalPostUrl: true,
        lastError: true,
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return posts.map((post) => ({
      ...post,
      mediaUrls:
        post.mediaUrls?.filter((url) => !url.startsWith('data:')) ?? [],
    }));
  }

  override async listPosts(
    status?: ScheduledPostStatus,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const workspaceId = await this.requestWorkspaceId();

    if (!workspaceId) {
      return super.listPosts(status, from, to, limit);
    }

    const scheduledAt = this.buildScheduledAtRange(from, to);
    const posts = await this.scopedPrisma.scheduledPost.findMany({
      where: {
        brand: { workspaceId },
        channel: { workspaceId },
        ...(status ? { status } : {}),
        ...(Object.keys(scheduledAt).length ? { scheduledAt } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: this.safePostLimit(limit),
      select: {
        id: true,
        brandId: true,
        channelId: true,
        campaignId: true,
        historyId: true,
        platform: true,
        title: true,
        content: true,
        scheduledAt: true,
        timezone: true,
        status: true,
        externalPostId: true,
        externalPostUrl: true,
        publishedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        channel: {
          select: {
            id: true,
            name: true,
            platform: true,
            brandId: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return posts.map((post) => ({
      ...post,
      mediaUrls: [] as string[],
    }));
  }

  override async getChannel(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.getChannel(id);
  }

  override async createChannel(
    input: Parameters<AutomationService['createChannel']>[0],
  ) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertBrand(workspaceId, input.brandId);
    }

    return super.createChannel(input);
  }

  override async updateChannel(
    id: string,
    input: Parameters<AutomationService['updateChannel']>[1],
  ) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.updateChannel(id, input);
  }

  override async removeChannel(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.removeChannel(id);
  }

  override async disconnectChannel(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.disconnectChannel(id);
  }

  override async disconnectChannelApi(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.disconnectChannelApi(id);
  }

  override async testChannel(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.testChannel(id);
  }

  override async testInstagramApiChannel(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.testInstagramApiChannel(id);
  }

  override async updateChannelStatus(
    id: string,
    status: Parameters<AutomationService['updateChannelStatus']>[1],
    lastError?: string,
  ) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertChannel(workspaceId, id);
    }

    return super.updateChannelStatus(id, status, lastError);
  }

  override async getPost(id: string) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      const post = await this.scopedPrisma.scheduledPost.findFirst({
        where: {
          id,
          brand: { workspaceId },
          channel: { workspaceId },
        },
        select: { id: true },
      });

      if (!post) {
        throw new NotFoundException('Scheduled post not found.');
      }
    }

    return super.getPost(id);
  }

  override async createPost(
    input: Parameters<AutomationService['createPost']>[0],
  ) {
    const workspaceId = await this.requestWorkspaceId();
    const scheduledAt = new Date(input.scheduledAt);
    const status = input.status ?? ScheduledPostStatus.DRAFT;

    if (!Number.isNaN(scheduledAt.getTime())) {
      this.validateScheduledTime(status, scheduledAt);
    }

    if (workspaceId) {
      await this.assertBrand(workspaceId, input.brandId);
      await this.assertChannel(workspaceId, input.channelId, input.brandId);
    }

    return super.createPost(input);
  }

  override async createMultiPlatformPosts(
    input: Parameters<AutomationService['createMultiPlatformPosts']>[0],
  ) {
    const workspaceId = await this.requestWorkspaceId();

    if (workspaceId) {
      await this.assertBrand(workspaceId, input.brandId);
    }

    return super.createMultiPlatformPosts(input);
  }

  override async updatePost(
    id: string,
    input: Parameters<AutomationService['updatePost']>[1],
  ) {
    const current = await this.getPost(id);
    const status = input.status ?? current.status;
    const scheduledAt = input.scheduledAt
      ? new Date(input.scheduledAt)
      : current.scheduledAt;

    if (!Number.isNaN(scheduledAt.getTime())) {
      this.validateScheduledTime(status, scheduledAt);
    }

    return super.updatePost(id, input);
  }

  override async getSettings() {
    const workspaceId = await this.requestWorkspaceId();

    if (!workspaceId) {
      return super.getSettings();
    }

    return this.scopedPrisma.automationSetting.upsert({
      where: { workspaceId },
      update: {},
      create: { workspaceId },
    });
  }
}
