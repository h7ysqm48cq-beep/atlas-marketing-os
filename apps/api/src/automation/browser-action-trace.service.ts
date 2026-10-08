import {
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BrowserTraceStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { AuthContextService } from '../auth/auth-context.service';
import { WorkspaceScopeService } from '../auth/workspace-scope.service';

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
    @Optional()
    private readonly authContext?:
      AuthContextService,
    @Optional()
    private readonly workspaceScope?:
      WorkspaceScopeService,
  ) {}

  async startStep(
    input: StartBrowserTraceInput,
  ) {
    await this.requireActionAccess(
      input.browserActionId,
    );

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
      await this.requireTraceTiming(
        id,
      );

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
      await this.requireTraceTiming(
        id,
      );

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

  async importWorkerTrace(
    browserActionId: string,
    steps: unknown,
  ) {
    if (!Array.isArray(steps)) {
      return [];
    }

    await this.requireActionAccess(
      browserActionId,
    );

    const validStatuses =
      new Set([
        'SUCCESS',
        'FAILED',
        'SKIPPED',
      ]);

    const normalized =
      steps.flatMap(
        (rawStep) => {
          if (
            !rawStep ||
            typeof rawStep !==
              'object'
          ) {
            return [];
          }

          const step =
            rawStep as Record<
              string,
              unknown
            >;

          const stepKey =
            typeof step.stepKey ===
              'string'
              ? step.stepKey
              : '';

          const stepName =
            typeof step.stepName ===
              'string'
              ? step.stepName
              : stepKey;

          const stepOrder =
            typeof step.stepOrder ===
              'number'
              ? step.stepOrder
              : Number.NaN;

          const rawStatus =
            typeof step.status ===
              'string'
              ? step.status
              : '';

          if (
            !stepKey ||
            !Number.isInteger(
              stepOrder,
            ) ||
            !validStatuses.has(
              rawStatus,
            )
          ) {
            return [];
          }

          const status =
            rawStatus ===
              'FAILED'
              ? BrowserTraceStatus.FAILED
              : rawStatus ===
                  'SKIPPED'
                ? BrowserTraceStatus.SKIPPED
                : BrowserTraceStatus.SUCCESS;

          const startedAt =
            typeof step.startedAt ===
              'string'
              ? new Date(
                  step.startedAt,
                )
              : new Date();

          const completedAt =
            typeof step.completedAt ===
              'string'
              ? new Date(
                  step.completedAt,
                )
              : startedAt;

          const suppliedDuration =
            typeof step.durationMs ===
              'number' &&
            Number.isFinite(
              step.durationMs,
            )
              ? Math.max(
                  0,
                  Math.round(
                    step.durationMs,
                  ),
                )
              : null;

          const durationMs =
            suppliedDuration ??
            Math.max(
              0,
              completedAt.getTime() -
                startedAt.getTime(),
            );

          const metadata =
            step.metadata &&
            typeof step.metadata ===
              'object'
              ? step.metadata
              : undefined;

          const errorMessage =
            typeof step.errorMessage ===
              'string'
              ? step.errorMessage
              : null;

          const screenshotPath =
            typeof step.screenshotPath ===
              'string'
              ? step.screenshotPath
              : null;

          return [
            {
              browserActionId,
              stepKey,
              stepName,
              stepOrder,
              status,
              metadata:
                serializeJson(
                  metadata,
                ),
              errorMessage,
              screenshotPath,
              startedAt:
                Number.isNaN(
                  startedAt.getTime(),
                )
                  ? new Date()
                  : startedAt,
              completedAt:
                Number.isNaN(
                  completedAt.getTime(),
                )
                  ? new Date()
                  : completedAt,
              durationMs,
            },
          ];
        },
      );

    if (!normalized.length) {
      return [];
    }

    await this.prisma
      .browserActionTrace
      .createMany({
        data:
          normalized,
        skipDuplicates:
          true,
      });

    return this.listForAction(
      browserActionId,
    );
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
    await this.requireActionAccess(
      input.browserActionId,
    );
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
    await this.requireActionAccess(
      input.browserActionId,
    );
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
    await this.requireActionAccess(
      browserActionId,
    );

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
    const workspaceId =
      await this.requestWorkspaceId();

    return this.prisma
      .browserActionTrace
      .findMany({
        where: {
          browserAction: {
            flowId,
            ...(workspaceId
              ? {
                  channel: {
                    workspaceId,
                  },
                }
              : {}),
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

  private async requireActionAccess(
    browserActionId: string,
  ): Promise<void> {
    const workspaceId =
      await this.requestWorkspaceId();
    const action = workspaceId
      ? await this.prisma
          .browserActionHistory
          .findFirst({
            where: {
              id: browserActionId,
              channel: {
                workspaceId,
              },
            },
            select: {
              id: true,
            },
          })
      : await this.prisma
          .browserActionHistory
          .findUnique({
            where: {
              id: browserActionId,
            },
            select: {
              id: true,
            },
          });

    if (!action) {
      throw new NotFoundException(
        'Browser Agent action was not found.',
      );
    }
  }

  private async requireTraceTiming(
    id: string,
  ) {
    const workspaceId =
      await this.requestWorkspaceId();
    const trace = workspaceId
      ? await this.prisma
          .browserActionTrace
          .findFirst({
            where: {
              id,
              browserAction: {
                channel: {
                  workspaceId,
                },
              },
            },
            select: {
              id: true,
              startedAt: true,
            },
          })
      : await this.prisma
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

    if (!trace) {
      throw new NotFoundException(
        'Browser execution trace step was not found.',
      );
    }

    return trace;
  }
}
