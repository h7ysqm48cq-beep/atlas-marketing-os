import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BrowserTraceStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

type StartBrowserTraceInput = {
  browserActionId: string;
  stepKey: string;
  stepName: string;
  stepOrder: number;
  metadata?: unknown;
  screenshotPath?: string | null;
};

function serializeJson(
  value: unknown,
) {
  return value == null
    ? undefined
    : JSON.parse(
        JSON.stringify(value),
      );
}

@Injectable()
export class BrowserActionTraceService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  async startStep(
    input: StartBrowserTraceInput,
  ) {
    const browserAction =
      await this.prisma
        .browserActionHistory
        .findUnique({
          where: {
            id:
              input.browserActionId,
          },
          select: {
            id: true,
          },
        });

    if (!browserAction) {
      throw new NotFoundException(
        'Browser Agent action was not found.',
      );
    }

    return this.prisma
      .browserActionTrace
      .create({
        data: {
          browserActionId:
            input.browserActionId,
          stepKey:
            input.stepKey,
          stepName:
            input.stepName,
          stepOrder:
            input.stepOrder,
          status:
            BrowserTraceStatus.PENDING,
          metadata:
            serializeJson(
              input.metadata,
            ),
          screenshotPath:
            input.screenshotPath ||
            null,
        },
      });
  }

  async succeedStep(
    id: string,
    input: {
      metadata?: unknown;
      screenshotPath?: string | null;
    } = {},
  ) {
    const existing =
      await this.prisma
        .browserActionTrace
        .findUnique({
          where: {
            id,
          },
          select: {
            id: true,
            startedAt: true,
          },
        });

    if (!existing) {
      throw new NotFoundException(
        'Browser execution trace step was not found.',
      );
    }

    const completedAt =
      new Date();

    return this.prisma
      .browserActionTrace
      .update({
        where: {
          id,
        },
        data: {
          status:
            BrowserTraceStatus.SUCCESS,
          completedAt,
          durationMs:
            completedAt.getTime() -
            existing.startedAt.getTime(),
          metadata:
            serializeJson(
              input.metadata,
            ),
          screenshotPath:
            input.screenshotPath ===
            undefined
              ? undefined
              : input.screenshotPath,
          errorMessage:
            null,
        },
      });
  }

  async failStep(
    id: string,
    error: unknown,
    input: {
      metadata?: unknown;
      screenshotPath?: string | null;
    } = {},
  ) {
    const existing =
      await this.prisma
        .browserActionTrace
        .findUnique({
          where: {
            id,
          },
          select: {
            id: true,
            startedAt: true,
          },
        });

    if (!existing) {
      throw new NotFoundException(
        'Browser execution trace step was not found.',
      );
    }

    const completedAt =
      new Date();

    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    return this.prisma
      .browserActionTrace
      .update({
        where: {
          id,
        },
        data: {
          status:
            BrowserTraceStatus.FAILED,
          completedAt,
          durationMs:
            completedAt.getTime() -
            existing.startedAt.getTime(),
          errorMessage,
          metadata:
            serializeJson(
              input.metadata,
            ),
          screenshotPath:
            input.screenshotPath ===
            undefined
              ? undefined
              : input.screenshotPath,
        },
      });
  }

  async recordCompletedStep(
    input: {
      browserActionId: string;
      stepKey: string;
      stepName: string;
      stepOrder: number;
      success: boolean;
      metadata?: unknown;
      errorMessage?: string | null;
      screenshotPath?: string | null;
    },
  ) {
    const now =
      new Date();

    return this.prisma
      .browserActionTrace
      .create({
        data: {
          browserActionId:
            input.browserActionId,
          stepKey:
            input.stepKey,
          stepName:
            input.stepName,
          stepOrder:
            input.stepOrder,
          status:
            input.success
              ? BrowserTraceStatus.SUCCESS
              : BrowserTraceStatus.FAILED,
          startedAt:
            now,
          completedAt:
            now,
          durationMs:
            0,
          metadata:
            serializeJson(
              input.metadata,
            ),
          errorMessage:
            input.errorMessage ||
            null,
          screenshotPath:
            input.screenshotPath ||
            null,
        },
      });
  }

  async skipStep(
    input: {
      browserActionId: string;
      stepKey: string;
      stepName: string;
      stepOrder: number;
      reason?: string;
      metadata?: unknown;
    },
  ) {
    const now =
      new Date();

    return this.prisma
      .browserActionTrace
      .create({
        data: {
          browserActionId:
            input.browserActionId,
          stepKey:
            input.stepKey,
          stepName:
            input.stepName,
          stepOrder:
            input.stepOrder,
          status:
            BrowserTraceStatus.SKIPPED,
          startedAt:
            now,
          completedAt:
            now,
          durationMs:
            0,
          errorMessage:
            input.reason ||
            null,
          metadata:
            serializeJson(
              input.metadata,
            ),
        },
      });
  }

  async listForAction(
    browserActionId: string,
  ) {
    return this.prisma
      .browserActionTrace
      .findMany({
        where: {
          browserActionId,
        },
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
      });
  }

  async listForFlow(
    flowId: string,
  ) {
    return this.prisma
      .browserActionTrace
      .findMany({
        where: {
          browserAction: {
            flowId,
          },
        },
        include: {
          browserAction: {
            select: {
              id: true,
              action: true,
              status: true,
              flowId: true,
              createdAt: true,
            },
          },
        },
        orderBy: [
          {
            browserAction: {
              createdAt:
                'asc',
            },
          },
          {
            stepOrder:
              'asc',
          },
        ],
      });
  }
}
