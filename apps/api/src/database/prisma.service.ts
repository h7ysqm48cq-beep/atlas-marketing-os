import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString =
      configService.getOrThrow<string>(
        'DATABASE_URL',
      );

    /*
     * The hosted Postgres pool currently has a
     * limited number of session-mode connections.
     *
     * Do not allow one Atlas API process to consume
     * the entire database pool.
     */
    const configuredPoolMax =
      Number(
        configService.get<string>(
          'DATABASE_POOL_MAX',
        ) ?? '4',
      );

    const poolMax =
      Number.isFinite(
        configuredPoolMax,
      ) &&
      configuredPoolMax > 0
        ? Math.floor(
            configuredPoolMax,
          )
        : 4;

    const adapter =
      new PrismaPg({
        connectionString,

        max:
          poolMax,

        idleTimeoutMillis:
          30_000,

        connectionTimeoutMillis:
          10_000,
      });

    super({
      adapter,
    });
  }

  async verifyConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
