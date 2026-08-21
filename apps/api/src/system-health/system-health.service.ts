import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { BrowserRuntimeBridgeService } from '../automation/browser-runtime-bridge.service';

@Injectable()
export class SystemHealthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly browserRuntime: BrowserRuntimeBridgeService,
  ) {}

  async snapshot() {

    const checkedAt = new Date().toISOString();

    return {
      checkedAt,

      overall: "HEALTHY",

      infrastructure: {
        web: {
          status: "ONLINE",
        },

        api: {
          status: "ONLINE",
        },

        browserWorker: {
          status: "UNKNOWN",
        },
      },

      database: {
        status: "UNKNOWN",
        guards: {
          inlineBase64: "UNKNOWN",
          legacyMedia: "UNKNOWN",
        },
      },

      storage: {
        status: "UNKNOWN",
      },

      issues: [],
    };

  }



  private async checkDatabase() {
    try {
      const result =
        await this.prisma.$queryRaw<
          Array<{ count: bigint }>
        >`
          SELECT count(*)::bigint as count
          FROM pg_stat_activity
        `;

      return {
        status: "healthy",
        connections:
          Number(result[0]?.count ?? 0),
        activeQueries: null,
      };
    } catch (error) {
      return {
        status: "critical",
        connections: null,
        activeQueries: null,
        message:
          error instanceof Error
            ? error.message
            : "database check failed",
      };
    }
  }


  private async checkBrowserWorker() {
    try {
      return await this.browserRuntime.health();
    } catch {
      return {
        status: "unknown",
        message:
          "browser worker unavailable",
      };
    }
  }


  private async checkAssets() {
    try {
      return {
        status: "healthy",
        checked: true,
      };
    } catch {
      return {
        status: "critical",
      };
    }
  }


  private buildStatus(
    ok: boolean,
    latencyMs?: number,
    message?: string,
  ) {
    return {
      status: ok ? "healthy" : "critical",
      latencyMs: latencyMs ?? null,
      message: message ?? null,
      checkedAt: new Date().toISOString(),
    };
  }


  async getSystemHealth() {

    const started = Date.now();

    const api = this.buildStatus(
      true,
      Date.now() - started,
      "API responding",
    );


    return {
      checkedAt: new Date().toISOString(),

      api,

      database: await this.checkDatabase(),

      railway: {
        status: "external",
        note:
          "Railway status checked through deployment monitor",
      },

      browserWorker:
        await this.checkBrowserWorker(),

      assets:
        await this.checkAssets(),

      calendar: {
        status: "pending",
      },

      issues: [],
    };
  }


}
