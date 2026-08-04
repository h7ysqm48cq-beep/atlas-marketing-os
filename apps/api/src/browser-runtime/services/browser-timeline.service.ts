import {
  Injectable,
} from '@nestjs/common';
import {
  BrowserAccountEventStatus,
} from '../../generated/prisma/client';
import {
  PrismaService,
} from '../../database/prisma.service';

@Injectable()
export class BrowserTimelineService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  record(input: {
    accountId: string;
    eventType: string;
    status?:
      BrowserAccountEventStatus;
    title: string;
    message?: string | null;
    metadata?: unknown;
  }) {
    return this.prisma
      .browserAccountEvent
      .create({
        data: {
          browserAccountId:
            input.accountId,
          eventType:
            input.eventType,
          status:
            input.status ??
            BrowserAccountEventStatus.INFO,
          title:
            input.title,
          message:
            input.message?.trim() ||
            null,
          metadata:
            input.metadata ===
            undefined
              ? undefined
              : JSON.parse(
                  JSON.stringify(
                    input.metadata,
                  ),
                ),
        },
      });
  }

  list(
    accountId: string,
    limit = 100,
  ) {
    const safeLimit =
      Math.min(
        Math.max(
          Math.trunc(limit),
          1,
        ),
        500,
      );

    return this.prisma
      .browserAccountEvent
      .findMany({
        where: {
          browserAccountId:
            accountId,
        },
        orderBy: {
          createdAt:
            'desc',
        },
        take:
          safeLimit,
      });
  }
}
