import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const databaseUrl = new URL(connectionString);
    const isSupabaseHost =
      databaseUrl.hostname.endsWith('.supabase.co') ||
      databaseUrl.hostname.endsWith('.pooler.supabase.com');

    /*
     * Supabase can enforce SSL at the Postgres / Supavisor layer.
     * Keep local or non-Supabase Postgres connections unchanged while
     * ensuring Atlas always uses encrypted transport for Supabase.
     */
    if (isSupabaseHost) {
      databaseUrl.searchParams.set('sslmode', 'require');
    }

    /*
     * The hosted Postgres pool currently has a
     * limited number of session-mode connections.
     *
     * Do not allow one Atlas API process to consume
     * the entire database pool.
     */
    const configuredPoolMax = Number(
      configService.get<string>('DATABASE_POOL_MAX') ?? '4',
    );

    const poolMax =
      Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
        ? Math.floor(configuredPoolMax)
        : 4;

    const adapter = new PrismaPg({
      connectionString: databaseUrl.toString(),

      /*
       * Keep the per-process pool deliberately small.
       *
       * Atlas can run several database-heavy background jobs while
       * interactive requests such as Calendar and Copilot are active.
       * A small pool prevents one API process from monopolising the
       * hosted Supabase session pool.
       */
      max: poolMax,

      /*
       * Reuse established database sessions instead of discarding them
       * aggressively. This reduces connection churn against Supavisor.
       */
      idleTimeoutMillis: 300_000,

      /*
       * Supavisor session mode may queue clients when backend database
       * connections are temporarily busy. Ten seconds is too aggressive
       * for the current Atlas workload and can turn transient pressure
       * into application-level failures.
       */
      connectionTimeoutMillis: 60_000,
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
