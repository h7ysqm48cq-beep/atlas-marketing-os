import {
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BrowserActionStatus,
  BrowserActionType,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { AuthContextService } from '../auth/auth-context.service';
import { WorkspaceScopeService } from '../auth/workspace-scope.service';

type StartBrowserActionInput = {
  channelId: string;
  flowId?: string | null;
  action: BrowserActionType;
  browserProfileKey?: string | null;
  caption?: string | null;
  imagePath?: string | null;
  requestPayload?: unknown;
};

@Injectable()
export class BrowserActionHistoryService {
  constructor(
    private readonly prisma:
      PrismaService,
    @Optional()
    private readonly authContext?:
      AuthContextService,
    @Optional()
    private readonly workspaceScope?:
      WorkspaceScopeService,
  ) {}

  async start(
    input: StartBrowserActionInput,
  ) {
    await this.assertChannelAccess(
      input.channelId,
    );

    return this.prisma
      .browserActionHistory
      .create({
        data: {
          channelId:
            input.channelId,
          flowId:
            input.flowId ||
            null,
          action:
            input.action,
          status:
            BrowserActionStatus.PENDING,
          browserProfileKey:
            input.browserProfileKey ||
            null,
          caption:
            input.caption ||
            null,
          imagePath:
            input.imagePath ||
            null,
          requestPayload:
            input.requestPayload
              ? JSON.parse(
                  JSON.stringify(
                    input.requestPayload,
                  ),
                )
              : undefined,
        },
      });
  }

  async succeed(
    id: string,
    input: {
      responsePayload?: unknown;
      screenshotPath?: string | null;
    } = {},
  ) {
    const existing =
      await this.requireActionTiming(
        id,
      );

    const completedAt =
      new Date();

    return this.prisma
      .browserActionHistory
      .update({
        where: {
          id,
        },
        data: {
          status:
            BrowserActionStatus.SUCCESS,
          responsePayload:
            input.responsePayload
              ? JSON.parse(
                  JSON.stringify(
                    input.responsePayload,
                  ),
                )
              : undefined,
          screenshotPath:
            input.screenshotPath ||
            null,
          errorMessage:
            null,
          completedAt,
          durationMs:
            completedAt.getTime() -
            existing.startedAt.getTime(),
        },
      });
  }

  async fail(
    id: string,
    error: unknown,
    responsePayload?: unknown,
  ) {
    const existing =
      await this.requireActionTiming(
        id,
      );

    const completedAt =
      new Date();

    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    return this.prisma
      .browserActionHistory
      .update({
        where: {
          id,
        },
        data: {
          status:
            BrowserActionStatus.FAILED,
          responsePayload:
            responsePayload
              ? JSON.parse(
                  JSON.stringify(
                    responsePayload,
                  ),
                )
              : undefined,
          errorMessage,
          completedAt,
          durationMs:
            completedAt.getTime() -
            existing.startedAt.getTime(),
        },
      });
  }

  async findOpenFlowId(
    channelId: string,
  ): Promise<string | null> {
    await this.assertChannelAccess(
      channelId,
    );

    const prepare =
      await this.prisma
        .browserActionHistory
        .findFirst({
          where: {
            channelId,
            action:
              BrowserActionType.PREPARE,
            status:
              BrowserActionStatus.SUCCESS,
            flowId: {
              not: null,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            flowId: true,
          },
        });

    const flowId =
      prepare?.flowId;

    if (!flowId) {
      return null;
    }

    const terminalAction =
      await this.prisma
        .browserActionHistory
        .findFirst({
          where: {
            flowId,
            channelId,
            action: {
              in: [
                BrowserActionType.PUBLISH,
                BrowserActionType.DISCARD,
              ],
            },
          },
          select: {
            id: true,
          },
        });

    return terminalAction
      ? null
      : flowId;
  }


  async getRequired(
    id: string,
  ) {
    const workspaceId =
      await this.requestWorkspaceId();
    const action = workspaceId
      ? await this.prisma
          .browserActionHistory
          .findFirst({
            where: {
              id,
              channel: {
                workspaceId,
              },
            },
          include: {
            channel: {
              select: {
                id: true,
                name: true,
                platform: true,
                username: true,
              },
            },
            traces: {
              orderBy: [
                {
                  stepOrder:
                    'asc',
                },
                {
                  createdAt:
                    'asc',
                },
              ],
            },
          },
        })
      : await this.prisma
          .browserActionHistory
          .findUnique({
            where: {
              id,
            },
            include: {
              channel: {
                select: {
                  id: true,
                  name: true,
                  platform: true,
                  username: true,
                },
              },
              traces: {
                orderBy: [
                  {
                    stepOrder:
                      'asc',
                  },
                  {
                    createdAt:
                      'asc',
                  },
                ],
              },
            },
          });

    if (!action) {
      throw new NotFoundException(
        'Browser Agent action was not found.',
      );
    }

    return action;
  }


  async listRecent(
    input: {
      channelId?: string;
      limit?: number;
    } = {},
  ) {
    const workspaceId =
      await this.requestWorkspaceId();
    const limit =
      Math.min(
        Math.max(
          input.limit || 20,
          1,
        ),
        100,
      );

    return this.prisma
      .browserActionHistory
      .findMany({
        where: workspaceId
          ? {
              channel: {
                workspaceId,
              },
              ...(input.channelId
                ? {
                    channelId:
                      input.channelId,
                  }
                : {}),
            }
          : input.channelId
            ? {
                channelId:
                  input.channelId,
              }
            : undefined,
        include: {
          channel: {
            select: {
              id: true,
              name: true,
              platform: true,
              username: true,
            },
          },
            traces: {
              orderBy: [
                {
                  stepOrder:
                    'asc',
                },
                {
                  createdAt:
                    'asc',
                },
              ],
            },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });
  }

  private async requestWorkspaceId(): Promise<string | null> {
    const userId =
      this.authContext?.getUserId() ??
      null;

    if (!userId) {
      return null;
    }

    if (!this.workspaceScope) {
      throw new NotFoundException(
        'Workspace not found.',
      );
    }

    return this.workspaceScope
      .getCurrentWorkspaceId();
  }

  private async assertChannelAccess(
    channelId: string,
  ): Promise<void> {
    const workspaceId =
      await this.requestWorkspaceId();

    if (!workspaceId) {
      return;
    }

    const channel =
      await this.prisma
        .socialChannel
        .findFirst({
          where: {
            id: channelId,
            workspaceId,
          },
          select: {
            id: true,
          },
        });

    if (!channel) {
      throw new NotFoundException(
        'Social channel not found.',
      );
    }
  }

  private async requireActionTiming(
    id: string,
  ) {
    const workspaceId =
      await this.requestWorkspaceId();
    const existing = workspaceId
      ? await this.prisma
          .browserActionHistory
          .findFirst({
            where: {
              id,
              channel: {
                workspaceId,
              },
            },
            select: {
              startedAt: true,
            },
          })
      : await this.prisma
          .browserActionHistory
          .findUnique({
            where: {
              id,
            },
            select: {
              startedAt: true,
            },
          });

    if (!existing) {
      throw new NotFoundException(
        'Browser Agent action was not found.',
      );
    }

    return existing;
  }
}
