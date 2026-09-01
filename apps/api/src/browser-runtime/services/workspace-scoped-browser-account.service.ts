import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceScopeService } from '../../auth/workspace-scope.service';
import { SocialTokenCryptoService } from '../../common/social-token-crypto.service';
import { PrismaService } from '../../database/prisma.service';
import { BrowserAccountService } from './browser-account.service';

@Injectable()
export class WorkspaceScopedBrowserAccountService extends BrowserAccountService {
  constructor(
    private readonly scopedPrisma: PrismaService,
    socialTokenCrypto: SocialTokenCryptoService,
    private readonly workspaceScope: WorkspaceScopeService,
  ) {
    super(scopedPrisma, socialTokenCrypto);
  }

  private async currentWorkspaceId() {
    return this.workspaceScope.getCurrentWorkspaceId();
  }

  private async requireAccount(id: string) {
    const workspaceId = await this.currentWorkspaceId();
    const account = await this.scopedPrisma.browserAccount.findFirst({
      where: {
        id: id.trim(),
        workspaceId,
      },
      select: {
        id: true,
        workspaceId: true,
        brandId: true,
        platform: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Browser account was not found.');
    }

    return account;
  }

  private async requireBrand(brandId: string) {
    const workspaceId = await this.currentWorkspaceId();
    const brand = await this.scopedPrisma.brand.findFirst({
      where: {
        id: brandId.trim(),
        workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!brand) {
      throw new NotFoundException('Brand was not found.');
    }

    return brand;
  }

  private async requireChannel(channelId: string) {
    const workspaceId = await this.currentWorkspaceId();
    const channel = await this.scopedPrisma.socialChannel.findFirst({
      where: {
        id: channelId.trim(),
        workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!channel) {
      throw new NotFoundException('Social channel was not found.');
    }

    return channel;
  }

  override async list() {
    const workspaceId = await this.currentWorkspaceId();
    const accounts = await this.scopedPrisma.browserAccount.findMany({
      where: {
        workspaceId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        channels: {
          include: {
            channel: true,
          },
        },
      },
    });

    return Promise.all(accounts.map((account) => super.getById(account.id)));
  }

  override async getById(id: string) {
    await this.requireAccount(id);
    return super.getById(id);
  }

  override async create(input: any) {
    const workspaceId = await this.currentWorkspaceId();
    const brandId = input.brandId?.trim() || null;

    if (brandId) {
      await this.requireBrand(brandId);
    }

    return super.create({
      ...input,
      workspaceId,
      brandId,
    });
  }

  override async update(id: string, input: any) {
    await this.requireAccount(id);

    if (input.brandId !== undefined && input.brandId !== null) {
      const brandId = input.brandId.trim();
      if (brandId) {
        await this.requireBrand(brandId);
      }
    }

    return super.update(id, input);
  }

  override async syncFacebookPages(accountId: string, input: any) {
    const account = await this.requireAccount(accountId);
    const brandId = input.brandId?.trim() || account.brandId?.trim() || '';

    if (brandId) {
      await this.requireBrand(brandId);
    }

    return super.syncFacebookPages(accountId, input);
  }

  override async linkChannel(accountId: string, channelId: string, input?: any) {
    await Promise.all([
      this.requireAccount(accountId),
      this.requireChannel(channelId),
    ]);

    return super.linkChannel(accountId, channelId, input);
  }

  override async selectForChannel(channelId: string, input?: any) {
    await this.requireChannel(channelId);

    const workspaceId = await this.currentWorkspaceId();
    const allowedAccounts = await this.scopedPrisma.browserAccount.findMany({
      where: {
        workspaceId,
      },
      select: {
        id: true,
      },
    });
    const allowedIds = new Set(allowedAccounts.map((account) => account.id));
    const selection = await super.selectForChannel(channelId, input);
    const candidates = selection.candidates.filter((candidate) =>
      allowedIds.has(candidate.id),
    );
    const selected = candidates.find((candidate) => candidate.eligible) || null;

    return {
      ...selection,
      selected,
      candidates,
      reason: selected
        ? 'BEST_ELIGIBLE_BROWSER_SELECTED'
        : candidates.length
          ? 'NO_ELIGIBLE_BROWSER_ACCOUNT'
          : 'NO_LINKED_BROWSER_ACCOUNT',
    };
  }

  override async pool() {
    const workspaceId = await this.currentWorkspaceId();
    const accounts = await this.scopedPrisma.browserAccount.findMany({
      where: {
        workspaceId,
      },
      orderBy: [
        {
          loginStatus: 'asc',
        },
        {
          updatedAt: 'desc',
        },
      ],
      include: {
        channels: {
          include: {
            channel: {
              select: {
                id: true,
                name: true,
                platform: true,
                status: true,
                externalId: true,
                username: true,
              },
            },
          },
        },
      },
    });

    const now = Date.now();
    const pool = accounts.map((account) => {
      let healthScore = 100;
      const warnings: string[] = [];
      const loginStatus = String(account.loginStatus || 'UNKNOWN')
        .trim()
        .toUpperCase();
      const cookieStatus = String(account.cookieStatus || 'UNKNOWN')
        .trim()
        .toUpperCase();

      if (loginStatus !== 'LOGGED_IN') {
        healthScore -= 40;
        warnings.push(`Login status: ${loginStatus}`);
      }

      if (cookieStatus !== 'ACTIVE') {
        healthScore -= 25;
        warnings.push(`Cookie status: ${cookieStatus}`);
      }

      if (account.proxyType !== 'DIRECT' && !account.lastKnownIp) {
        healthScore -= 10;
        warnings.push('Proxy IP has not been verified.');
      }

      let heartbeatAgeSeconds: number | null = null;
      if (account.lastHeartbeatAt) {
        heartbeatAgeSeconds = Math.max(
          0,
          Math.floor((now - account.lastHeartbeatAt.getTime()) / 1000),
        );

        if (heartbeatAgeSeconds > 86400) {
          healthScore -= 15;
          warnings.push('Heartbeat is older than 24 hours.');
        } else if (heartbeatAgeSeconds > 3600) {
          healthScore -= 5;
          warnings.push('Heartbeat is older than 1 hour.');
        }
      } else {
        healthScore -= 10;
        warnings.push('No browser heartbeat recorded.');
      }

      if (account.lastLoginError) {
        healthScore -= 10;
        warnings.push(account.lastLoginError);
      }

      healthScore = Math.max(0, Math.min(100, healthScore));
      const healthStatus =
        healthScore >= 80 ? 'HEALTHY' : healthScore >= 50 ? 'WARNING' : 'CRITICAL';
      const availability =
        loginStatus === 'LOGGED_IN' && healthScore >= 80
          ? 'AVAILABLE'
          : loginStatus === 'LOGGED_IN'
            ? 'ATTENTION'
            : 'LOGIN_REQUIRED';

      return {
        id: account.id,
        displayName: account.displayName,
        platform: account.platform,
        browserProfileKey: account.browserProfileKey,
        browserProfileName: account.browserProfileName,
        locale: account.locale,
        timezone: account.timezone,
        proxyType: account.proxyType,
        proxyCountry: account.proxyCountry,
        lastKnownIp: account.lastKnownIp,
        loginStatus: account.loginStatus,
        cookieStatus: account.cookieStatus,
        lastLoginAt: account.lastLoginAt,
        lastVerifiedAt: account.lastVerifiedAt,
        lastHeartbeatAt: account.lastHeartbeatAt,
        heartbeatAgeSeconds,
        lastLoginError: account.lastLoginError,
        pageCount: account.channels.length,
        pages: account.channels.map((link) => ({
          id: link.channel.id,
          name: link.channel.name,
          platform: link.channel.platform,
          status: link.channel.status,
          externalId: link.channel.externalId,
          username: link.channel.username,
          isPrimary: link.isPrimary,
        })),
        health: {
          score: healthScore,
          status: healthStatus,
          warnings,
        },
        availability,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
    });

    return {
      summary: {
        total: pool.length,
        healthy: pool.filter((account) => account.health.status === 'HEALTHY').length,
        warning: pool.filter((account) => account.health.status === 'WARNING').length,
        critical: pool.filter((account) => account.health.status === 'CRITICAL').length,
        available: pool.filter((account) => account.availability === 'AVAILABLE').length,
        loginRequired: pool.filter(
          (account) => account.availability === 'LOGIN_REQUIRED',
        ).length,
      },
      accounts: pool,
      generatedAt: new Date().toISOString(),
    };
  }

  override async getLaunchProfile(id: string) {
    await this.requireAccount(id);
    return super.getLaunchProfile(id);
  }

  override async getLoginCredentials(id: string) {
    await this.requireAccount(id);
    return super.getLoginCredentials(id);
  }

  override async markLoginRequired(id: string, message?: string) {
    await this.requireAccount(id);
    return super.markLoginRequired(id, message);
  }

  override async markLoginVerified(id: string, message?: string) {
    await this.requireAccount(id);
    return super.markLoginVerified(id, message);
  }
}
