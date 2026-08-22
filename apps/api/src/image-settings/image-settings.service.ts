import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

type ImageSettingPatch = {
  textOverlayEnabled?: boolean;
  textOverlayText?: string;
  qrEnabled?: boolean;
  qrLinks?: string;
  brandFooterEnabled?: boolean;
  footerText?: string;
  footerPosition?: string;
  footerStyle?: string;
  footerLogoMode?: string;

  cornerLogoEnabled?: boolean;
  cornerLogoPlacement?: string;
  cornerLogoScale?: number;
  cornerLogoOpacity?: number;
};

type ImageSettingScope = {
  pageId?: string | null;
  channelId?: string | null;
};

@Injectable()
export class ImageSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeId(value?: string | null) {
    const normalized = value?.trim();

    return normalized || null;
  }

  private normalizeQrLinks(value?: string | null) {
    return Array.from(
      new Set(
        (value ?? '')
          .split(/\r?\n/)
          .map((link) => link.trim())
          .filter((link) => {
            try {
              const parsed = new URL(link);
              return (
                parsed.protocol === 'http:' || parsed.protocol === 'https:'
              );
            } catch {
              return false;
            }
          }),
      ),
    )
      .slice(0, 3)
      .join('\n');
  }

  private async getWorkspaceId() {
    const activeBrand = await this.prisma.brand.findFirst({
      where: {
        status: 'ACTIVE',
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        workspaceId: true,
      },
    });

    if (activeBrand?.workspaceId) {
      return activeBrand.workspaceId;
    }

    const workspace = await this.prisma.workspace.findFirst({
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
    });

    if (!workspace) {
      throw new InternalServerErrorException('No workspace is available.');
    }

    return workspace.id;
  }

  private async ensureWorkspaceDefault(workspaceId: string) {
    let setting = await this.prisma.imageGenerationSetting.findFirst({
      where: {
        workspaceId,
        pageId: null,
        channelId: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!setting) {
      setting = await this.prisma.imageGenerationSetting.create({
        data: {
          workspaceId,
          pageId: null,
          channelId: null,
          textOverlayEnabled: true,
          textOverlayText: '',
          qrEnabled: false,
          qrLinks: '',
          brandFooterEnabled: true,
          footerText: '满贯门 mgmbetmyr.com',
          footerPosition: 'bottom-center',
          footerStyle: 'minimal',
          footerLogoMode: 'auto',
          cornerLogoEnabled: false,
          cornerLogoPlacement: 'TOP_RIGHT',
          cornerLogoScale: 1,
          cornerLogoOpacity: 1,
        },
      });
    }

    return setting;
  }

  async get(scope: ImageSettingScope = {}) {
    const workspaceId = await this.getWorkspaceId();

    const pageId = this.normalizeId(scope.pageId);

    const channelId = this.normalizeId(scope.channelId);

    const workspaceDefault = await this.ensureWorkspaceDefault(workspaceId);

    /*
     * Priority:
     *
     * 1. Page + Channel
     * 2. Channel
     * 3. Page
     * 4. Workspace Default
     */

    if (channelId && pageId) {
      const exact = await this.prisma.imageGenerationSetting.findFirst({
        where: {
          workspaceId,
          pageId,
          channelId,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (exact) {
        return {
          ...exact,
          effectiveScope: 'page-channel',
          inherited: false,
        };
      }
    }

    if (channelId) {
      const channelSetting = await this.prisma.imageGenerationSetting.findFirst(
        {
          where: {
            workspaceId,
            pageId: null,
            channelId,
          },
          orderBy: {
            updatedAt: 'desc',
          },
        },
      );

      if (channelSetting) {
        return {
          ...channelSetting,
          effectiveScope: 'channel',
          inherited: false,
        };
      }
    }

    if (pageId) {
      const pageSetting = await this.prisma.imageGenerationSetting.findFirst({
        where: {
          workspaceId,
          pageId,
          channelId: null,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (pageSetting) {
        return {
          ...pageSetting,
          effectiveScope: 'page',
          inherited: false,
        };
      }
    }

    return {
      ...workspaceDefault,
      effectiveScope: 'workspace',
      inherited: Boolean(pageId || channelId),
    };
  }

  async update(data: ImageSettingPatch, scope: ImageSettingScope = {}) {
    const workspaceId = await this.getWorkspaceId();

    const pageId = this.normalizeId(scope.pageId);

    const channelId = this.normalizeId(scope.channelId);

    const existing = await this.prisma.imageGenerationSetting.findFirst({
      where: {
        workspaceId,
        pageId,
        channelId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const patch = {
      ...(typeof data.textOverlayEnabled === 'boolean'
        ? {
            textOverlayEnabled: data.textOverlayEnabled,
          }
        : {}),

      ...(typeof data.textOverlayText === 'string'
        ? {
            textOverlayText: data.textOverlayText.trim().slice(0, 70),
          }
        : {}),

      ...(typeof data.qrEnabled === 'boolean'
        ? { qrEnabled: data.qrEnabled }
        : {}),

      ...(typeof data.qrLinks === 'string'
        ? {
            qrLinks: this.normalizeQrLinks(data.qrLinks),
          }
        : {}),

      ...(typeof data.brandFooterEnabled === 'boolean'
        ? {
            brandFooterEnabled: data.brandFooterEnabled,
          }
        : {}),

      ...(typeof data.footerText === 'string'
        ? {
            footerText: data.footerText.trim(),
          }
        : {}),

      ...(typeof data.footerPosition === 'string'
        ? {
            footerPosition: data.footerPosition,
          }
        : {}),

      ...(typeof data.footerStyle === 'string'
        ? {
            footerStyle: data.footerStyle,
          }
        : {}),

      ...(typeof data.footerLogoMode === 'string'
        ? {
            footerLogoMode: data.footerLogoMode,
          }
        : {}),

      ...(typeof data.cornerLogoEnabled === 'boolean'
        ? {
            cornerLogoEnabled: data.cornerLogoEnabled,
          }
        : {}),

      ...(typeof data.cornerLogoPlacement === 'string'
        ? {
            cornerLogoPlacement: data.cornerLogoPlacement,
          }
        : {}),

      ...(typeof data.cornerLogoScale === 'number'
        ? {
            cornerLogoScale: data.cornerLogoScale,
          }
        : {}),

      ...(typeof data.cornerLogoOpacity === 'number'
        ? {
            cornerLogoOpacity: data.cornerLogoOpacity,
          }
        : {}),
    };

    if (existing) {
      return this.prisma.imageGenerationSetting.update({
        where: {
          id: existing.id,
        },
        data: patch,
      });
    }

    /*
     * New override:
     * copy current effective parent values first,
     * then apply changed fields.
     */
    const parent = await this.get({
      pageId: channelId ? pageId : null,
      channelId: null,
    });

    return this.prisma.imageGenerationSetting.create({
      data: {
        workspaceId,
        pageId,
        channelId,

        textOverlayEnabled:
          data.textOverlayEnabled ?? parent.textOverlayEnabled,

        textOverlayText:
          data.textOverlayText?.trim().slice(0, 70) ?? parent.textOverlayText,

        qrEnabled: data.qrEnabled ?? parent.qrEnabled,

        qrLinks:
          data.qrLinks !== undefined
            ? this.normalizeQrLinks(data.qrLinks)
            : parent.qrLinks,

        brandFooterEnabled:
          data.brandFooterEnabled ?? parent.brandFooterEnabled,

        footerText: data.footerText?.trim() ?? parent.footerText,

        footerLogoMode: data.footerLogoMode ?? parent.footerLogoMode,

        cornerLogoEnabled: data.cornerLogoEnabled ?? parent.cornerLogoEnabled,

        cornerLogoPlacement:
          data.cornerLogoPlacement ?? parent.cornerLogoPlacement,

        cornerLogoScale: data.cornerLogoScale ?? parent.cornerLogoScale,

        cornerLogoOpacity: data.cornerLogoOpacity ?? parent.cornerLogoOpacity,

        footerPosition: data.footerPosition ?? parent.footerPosition,

        footerStyle: data.footerStyle ?? parent.footerStyle,
      },
    });
  }

  async listScopes() {
    const workspaceId = await this.getWorkspaceId();

    const channels = await this.prisma.socialChannel.findMany({
      where: {
        workspaceId,
      },
      orderBy: [
        {
          platform: 'asc',
        },
        {
          name: 'asc',
        },
      ],
      select: {
        id: true,
        platform: true,
        name: true,
        externalId: true,
        username: true,
        status: true,
      },
    });

    const pageMap = new Map<
      string,
      {
        id: string;
        name: string;
        channelId: string;
        status: string;
      }
    >();

    for (const channel of channels) {
      if (channel.platform === 'FACEBOOK' && channel.externalId) {
        pageMap.set(channel.externalId, {
          id: channel.externalId,
          name: channel.name,
          channelId: channel.id,
          status: channel.status,
        });
      }
    }

    return {
      pages: Array.from(pageMap.values()),

      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        platform: channel.platform,
        externalId: channel.externalId,
        username: channel.username,
        status: channel.status,
      })),
    };
  }

  async removeOverride(scope: ImageSettingScope) {
    const workspaceId = await this.getWorkspaceId();

    const pageId = this.normalizeId(scope.pageId);

    const channelId = this.normalizeId(scope.channelId);

    if (!pageId && !channelId) {
      /*
       * Workspace default cannot be deleted.
       */
      return this.get();
    }

    await this.prisma.imageGenerationSetting.deleteMany({
      where: {
        workspaceId,
        pageId,
        channelId,
      },
    });

    return this.get({
      pageId,
      channelId,
    });
  }
}
