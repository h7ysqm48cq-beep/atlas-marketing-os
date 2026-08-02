import {
  Injectable,
} from '@nestjs/common';
import {
  BrowserActionStatus,
  BrowserActionType,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

type StartBrowserActionInput = {
  channelId: string;
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
  ) {}

  async start(
    input: StartBrowserActionInput,
  ) {
    return this.prisma
      .browserActionHistory
      .create({
        data: {
          channelId:
            input.channelId,
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
      await this.prisma
        .browserActionHistory
        .findUniqueOrThrow({
          where: {
            id,
          },
          select: {
            startedAt: true,
          },
        });

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
      await this.prisma
        .browserActionHistory
        .findUniqueOrThrow({
          where: {
            id,
          },
          select: {
            startedAt: true,
          },
        });

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

  async listRecent(
    input: {
      channelId?: string;
      limit?: number;
    } = {},
  ) {
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
        where: input.channelId
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
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });
  }
}
