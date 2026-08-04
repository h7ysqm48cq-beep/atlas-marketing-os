import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  randomUUID,
} from 'node:crypto';
import {
  Prisma,
} from '../../generated/prisma/client';
import {
  PrismaService,
} from '../../database/prisma.service';

type AcquireLeaseInput = {
  ownerKey?: string;
  channelId?: string | null;
  durationSeconds?: number;
  metadata?: unknown;
};

@Injectable()
export class BrowserLeaseService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  async acquire(
    browserAccountId: string,
    input: AcquireLeaseInput,
  ) {
    const cleanAccountId =
      browserAccountId.trim();

    const ownerKey =
      input.ownerKey?.trim();

    if (!cleanAccountId) {
      throw new BadRequestException(
        'browserAccountId is required.',
      );
    }

    if (!ownerKey) {
      throw new BadRequestException(
        'ownerKey is required.',
      );
    }

    const requestedDuration =
      Number(
        input.durationSeconds ??
        300,
      );

    const durationSeconds =
      Math.min(
        Math.max(
          Math.trunc(
            requestedDuration,
          ),
          30,
        ),
        1800,
      );

    const now =
      new Date();

    const expiresAt =
      new Date(
        now.getTime() +
        durationSeconds *
          1000,
      );

    const leaseToken =
      randomUUID();

    return this.prisma.$transaction(
      async (transaction) => {
        const account =
          await transaction
            .browserAccount
            .findUnique({
              where: {
                id:
                  cleanAccountId,
              },
              select: {
                id: true,
                displayName: true,
                browserProfileKey:
                  true,
                loginStatus: true,
                cookieStatus: true,
              },
            });

        if (!account) {
          throw new NotFoundException(
            'Browser account was not found.',
          );
        }

        const existing =
          await transaction
            .browserAccountLease
            .findUnique({
              where: {
                browserAccountId:
                  cleanAccountId,
              },
            });

        const existingIsActive =
          Boolean(
            existing &&
            !existing.releasedAt &&
            existing.expiresAt >
              now,
          );

        if (existingIsActive) {
          if (
            existing?.ownerKey ===
            ownerKey
          ) {
            const renewed =
              await transaction
                .browserAccountLease
                .update({
                  where: {
                    browserAccountId:
                      cleanAccountId,
                  },
                  data: {
                    expiresAt,
                    channelId:
                      input.channelId
                        ?.trim() ||
                      existing.channelId,
                    metadata:
                      this.toJson(
                        input.metadata,
                      ),
                  },
                });

            return {
              acquired: true,
              renewed: true,
              account,
              lease: renewed,
            };
          }

          throw new ConflictException({
            message:
              'Browser account is currently busy.',
            code:
              'BROWSER_ACCOUNT_BUSY',
            browserAccountId:
              cleanAccountId,
            currentOwner:
              existing?.ownerKey,
            expiresAt:
              existing?.expiresAt,
          });
        }

        const lease =
          await transaction
            .browserAccountLease
            .upsert({
              where: {
                browserAccountId:
                  cleanAccountId,
              },
              create: {
                browserAccountId:
                  cleanAccountId,
                leaseToken,
                ownerKey,
                channelId:
                  input.channelId
                    ?.trim() ||
                  null,
                acquiredAt:
                  now,
                expiresAt,
                releasedAt:
                  null,
                metadata:
                  this.toJson(
                    input.metadata,
                  ),
              },
              update: {
                leaseToken,
                ownerKey,
                channelId:
                  input.channelId
                    ?.trim() ||
                  null,
                acquiredAt:
                  now,
                expiresAt,
                releasedAt:
                  null,
                metadata:
                  this.toJson(
                    input.metadata,
                  ),
              },
            });

        return {
          acquired: true,
          renewed: false,
          account,
          lease,
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel
            .Serializable,
      },
    );
  }

  async release(
    browserAccountId: string,
    input: {
      leaseToken?: string;
      ownerKey?: string;
    },
  ) {
    const lease =
      await this.prisma
        .browserAccountLease
        .findUnique({
          where: {
            browserAccountId,
          },
        });

    if (!lease) {
      return {
        released: false,
        alreadyReleased: true,
      };
    }

    if (lease.releasedAt) {
      return {
        released: false,
        alreadyReleased: true,
        lease,
      };
    }

    const tokenMatches =
      Boolean(
        input.leaseToken &&
        input.leaseToken ===
          lease.leaseToken,
      );

    const ownerMatches =
      Boolean(
        input.ownerKey &&
        input.ownerKey.trim() ===
          lease.ownerKey,
      );

    if (
      !tokenMatches &&
      !ownerMatches
    ) {
      throw new ConflictException(
        'Lease token or ownerKey does not match the active lease.',
      );
    }

    const released =
      await this.prisma
        .browserAccountLease
        .update({
          where: {
            browserAccountId,
          },
          data: {
            releasedAt:
              new Date(),
          },
        });

    return {
      released: true,
      lease: released,
    };
  }

  async status(
    browserAccountId: string,
  ) {
    const lease =
      await this.prisma
        .browserAccountLease
        .findUnique({
          where: {
            browserAccountId,
          },
        });

    if (!lease) {
      return {
        busy: false,
        lease: null,
      };
    }

    const busy =
      !lease.releasedAt &&
      lease.expiresAt >
        new Date();

    return {
      busy,
      expired:
        !lease.releasedAt &&
        lease.expiresAt <=
          new Date(),
      lease,
    };
  }

  private toJson(
    value: unknown,
  ):
    | Prisma.InputJsonValue
    | undefined {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value),
    ) as Prisma.InputJsonValue;
  }
}
