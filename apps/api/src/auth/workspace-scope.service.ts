import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthContextService } from './auth-context.service';

@Injectable()
export class WorkspaceScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: AuthContextService,
  ) {}

  async getCurrentWorkspace() {
    const userId = this.authContext.getUserId();

    if (!userId) {
      return this.getSystemWorkspace();
    }

    return this.resolveUserWorkspace(userId);
  }

  async getCurrentWorkspaceId() {
    return (await this.getCurrentWorkspace()).id;
  }

  async getCurrentUserWorkspace() {
    const userId = this.authContext.requireUserId();
    return this.resolveUserWorkspace(userId);
  }

  async requireWorkspaceAccess(workspaceId: string) {
    const userId = this.authContext.getUserId();

    if (!userId) {
      const systemWorkspace = await this.getSystemWorkspace();

      if (systemWorkspace.id !== workspaceId) {
        throw new NotFoundException('Workspace not found.');
      }

      return systemWorkspace;
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      include: {
        workspace: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found.');
    }

    return membership.workspace;
  }

  private async resolveUserWorkspace(userId: string) {
    const defaultMembership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        isDefault: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        workspace: true,
      },
    });

    if (defaultMembership) {
      return defaultMembership.workspace;
    }

    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        workspace: true,
      },
    });

    if (membership) {
      await this.prisma.workspaceMember.update({
        where: {
          id: membership.id,
        },
        data: {
          isDefault: true,
        },
      });

      return membership.workspace;
    }

    const legacyWorkspace = await this.prisma.workspace.findUnique({
      where: {
        ownerUserId: userId,
      },
    });

    if (legacyWorkspace) {
      await this.prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: legacyWorkspace.id,
            userId,
          },
        },
        update: {
          role: 'OWNER',
          isDefault: true,
        },
        create: {
          workspaceId: legacyWorkspace.id,
          userId,
          role: 'OWNER',
          isDefault: true,
        },
      });

      return legacyWorkspace;
    }

    const workspace = await this.prisma.workspace.upsert({
      where: {
        ownerUserId: userId,
      },
      update: {},
      create: {
        name: 'Atlas Workspace',
        slug: `atlas-${userId}`,
        ownerUserId: userId,
      },
    });

    await this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId,
        },
      },
      update: {
        role: 'OWNER',
        isDefault: true,
      },
      create: {
        workspaceId: workspace.id,
        userId,
        role: 'OWNER',
        isDefault: true,
      },
    });

    return workspace;
  }

  private async getSystemWorkspace() {
    return this.prisma.workspace.upsert({
      where: {
        slug: 'mgmbetmyr',
      },
      update: {},
      create: {
        name: 'MGMBETMYR',
        slug: 'mgmbetmyr',
      },
    });
  }
}
