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
import {
  BrowserAccountService,
} from './browser-account.service';

type BrowserSelectionCandidate = {
  id: string;
  displayName: string;
  browserProfileKey: string;
  browserProfileName: string;
  loginStatus: string;
  cookieStatus: string;
  proxyType: string;
  proxyCountry: string | null;
  lastKnownIp: string | null;
  lastHeartbeatAt: Date | string | null;
  heartbeatAgeSeconds: number | null;
  isPrimary: boolean;
  healthScore: number;
  eligible: boolean;
  warnings: string[];
};

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
    private readonly browserAccounts:
      BrowserAccountService,
  ) {}

  async selectAndAcquire(
    input: {
      channelId?: string;
      ownerKey?: string;
      durationSeconds?: number;
      minimumHealthScore?: number;
      requireActiveCookie?: boolean;
      excludeAccountIds?: string[];
      metadata?: unknown;
    },
  ) {
    const channelId =
      input.channelId?.trim();

    const ownerKey =
      input.ownerKey?.trim();

    if (!channelId) {
      throw new BadRequestException(
        'channelId is required.',
      );
    }

    if (!ownerKey) {
      throw new BadRequestException(
        'ownerKey is required.',
      );
    }

    const excludedIds =
      new Set(
        (
          input.excludeAccountIds ||
          []
        )
          .map(
            (value) =>
              value?.trim(),
          )
          .filter(Boolean),
      );

    const selection =
      await this.browserAccounts
        .selectForChannel(
          channelId,
          {
            excludeAccountIds:
              Array.from(
                excludedIds,
              ),
            minimumHealthScore:
              input.minimumHealthScore,
            requireActiveCookie:
              input.requireActiveCookie,
          },
        );

    const candidates =
      selection.candidates as
        BrowserSelectionCandidate[];

    const eligibleCandidates =
      candidates.filter(
        (candidate) =>
          candidate.eligible &&
          !excludedIds.has(
            candidate.id,
          ),
      );

    if (!eligibleCandidates.length) {
      return {
        acquired: false,
        selected: null,
        lease: null,
        channel:
          selection.channel,
        reason:
          selection.reason ===
          'NO_LINKED_BROWSER_ACCOUNT'
            ? 'NO_LINKED_BROWSER_ACCOUNT'
            : 'NO_ELIGIBLE_BROWSER_ACCOUNT',
        attempts: [],
        candidates,
      };
    }

    const attempts: Array<{
      browserAccountId: string;
      displayName: string;
      acquired: boolean;
      reason: string;
    }> = [];

    for (
      const candidate
      of eligibleCandidates
    ) {
      try {
        const acquired =
          await this.acquire(
            candidate.id,
            {
              ownerKey,
              channelId,
              durationSeconds:
                input.durationSeconds,
              metadata: {
                ...(input.metadata &&
                typeof input.metadata ===
                  'object'
                  ? input.metadata
                  : {}),
                selection: {
                  healthScore:
                    candidate.healthScore,
                  isPrimary:
                    candidate.isPrimary,
                  selectedAt:
                    new Date()
                      .toISOString(),
                },
              },
            },
          );

        attempts.push({
          browserAccountId:
            candidate.id,
          displayName:
            candidate.displayName,
          acquired:
            true,
          reason:
            acquired.renewed
              ? 'LEASE_RENEWED'
              : 'LEASE_ACQUIRED',
        });

        return {
          acquired: true,
          selected:
            candidate,
          lease:
            acquired.lease,
          account:
            acquired.account,
          channel:
            selection.channel,
          reason:
            acquired.renewed
              ? 'BEST_BROWSER_LEASE_RENEWED'
              : 'BEST_BROWSER_SELECTED_AND_LOCKED',
          attempts,
          candidates,
          acquiredAt:
            new Date()
              .toISOString(),
        };
      } catch (error) {
        const response =
          error &&
          typeof error ===
            'object' &&
          'getResponse' in error &&
          typeof error.getResponse ===
            'function'
            ? error.getResponse()
            : null;

        const serialized =
          typeof response ===
          'string'
            ? response
            : JSON.stringify(
                response ||
                {},
              );

        const browserBusy =
          serialized.includes(
            'BROWSER_ACCOUNT_BUSY',
          ) ||
          (
            error instanceof
              ConflictException &&
            error.message.includes(
              'busy',
            )
          );

        if (!browserBusy) {
          throw error;
        }

        attempts.push({
          browserAccountId:
            candidate.id,
          displayName:
            candidate.displayName,
          acquired:
            false,
          reason:
            'BROWSER_ACCOUNT_BUSY',
        });

        excludedIds.add(
          candidate.id,
        );
      }
    }

    return {
      acquired: false,
      selected: null,
      lease: null,
      channel:
        selection.channel,
      reason:
        'ALL_ELIGIBLE_BROWSERS_BUSY',
      attempts,
      candidates,
    };
  }

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
