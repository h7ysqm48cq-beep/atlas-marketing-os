import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotService } from './copilot.service';
import { MarketingPlannerService } from './marketing-planner.service';

type CopilotJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

type CopilotJobType = 'COPILOT_CHAT' | 'COPILOT_MARKETING_PLAN';

type CopilotPayload =
  | { type: 'chat'; dto: ChatCopilotDto }
  | { type: 'marketing-plan'; dto: CreateMarketingPlanDto };

type BackgroundJobRow = {
  id: string;
  type?: CopilotJobType;
  status: CopilotJobStatus;
  payload?: unknown;
  result: unknown | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class CopilotBackgroundJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CopilotBackgroundJobService.name);
  private processing = false;
  private wakeupRequested = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly copilot: CopilotService,
    private readonly planner: MarketingPlannerService,
    private readonly conversations: ConversationMemoryService,
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.$executeRaw`
      UPDATE "BackgroundJob"
      SET
        "status" = 'QUEUED'::"BackgroundJobStatus",
        "updatedAt" = NOW()
      WHERE "type" IN (
        'COPILOT_CHAT'::"BackgroundJobType",
        'COPILOT_MARKETING_PLAN'::"BackgroundJobType"
      )
      AND "status" = 'RUNNING'::"BackgroundJobStatus"
    `;

    this.requestProcessing();
  }

  async enqueueChat(dto: ChatCopilotDto) {
    const firstMessage = dto.messages.find(
      (message) => message.role === 'user',
    )?.content;

    const conversation = await this.conversations.ensureConversation({
      conversationId: dto.conversationId,
      campaignId: dto.campaignId,
      mode: dto.mode || 'chat',
      firstMessage: firstMessage || 'New Copilot request',
    });

    const job = await this.enqueue({
      type: 'chat',
      dto: {
        ...dto,
        conversationId: conversation.id,
      },
    });

    return {
      ...job,
      conversationId: conversation.id,
    };
  }

  async enqueueMarketingPlan(dto: CreateMarketingPlanDto) {
    const conversation = await this.conversations.ensureConversation({
      conversationId: dto.conversationId,
      campaignId: dto.campaignId,
      mode: 'marketing-plan',
      firstMessage: dto.prompt,
    });

    const job = await this.enqueue({
      type: 'marketing-plan',
      dto: {
        ...dto,
        conversationId: conversation.id,
      },
    });

    return {
      ...job,
      conversationId: conversation.id,
    };
  }

  async get(id: string) {
    const rows = await this.prisma.$queryRaw<BackgroundJobRow[]>`
      SELECT
        "id",
        "status",
        "result",
        "error",
        "createdAt",
        "updatedAt"
      FROM "BackgroundJob"
      WHERE "id" = ${id}
      AND "type" IN (
        'COPILOT_CHAT'::"BackgroundJobType",
        'COPILOT_MARKETING_PLAN'::"BackgroundJobType"
      )
      LIMIT 1
    `;

    const job = rows[0];

    if (!job) {
      throw new NotFoundException('Copilot job not found.');
    }

    return this.publicJob(job);
  }

  private async enqueue(payload: CopilotPayload) {
    const id = randomUUID();
    const type: CopilotJobType =
      payload.type === 'chat' ? 'COPILOT_CHAT' : 'COPILOT_MARKETING_PLAN';
    const payloadJson = JSON.stringify(payload);

    const rows = await this.prisma.$queryRaw<BackgroundJobRow[]>`
      INSERT INTO "BackgroundJob" (
        "id",
        "type",
        "status",
        "payload",
        "attempts",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${id},
        ${type}::"BackgroundJobType",
        'QUEUED'::"BackgroundJobStatus",
        ${payloadJson}::jsonb,
        0,
        NOW(),
        NOW()
      )
      RETURNING
        "id",
        "status",
        "result",
        "error",
        "createdAt",
        "updatedAt"
    `;

    const job = rows[0];

    if (!job) {
      throw new Error('Unable to create Copilot job.');
    }

    this.requestProcessing();
    return this.publicJob(job);
  }

  private requestProcessing() {
    if (this.processing) {
      this.wakeupRequested = true;
      return;
    }

    void this.processQueue();
  }

  private async processQueue() {
    if (this.processing) {
      this.wakeupRequested = true;
      return;
    }

    this.processing = true;

    try {
      do {
        this.wakeupRequested = false;

        while (true) {
          const rows = await this.prisma.$queryRaw<BackgroundJobRow[]>`
            SELECT
              "id",
              "type",
              "status",
              "payload",
              "result",
              "error",
              "createdAt",
              "updatedAt"
            FROM "BackgroundJob"
            WHERE "type" IN (
              'COPILOT_CHAT'::"BackgroundJobType",
              'COPILOT_MARKETING_PLAN'::"BackgroundJobType"
            )
            AND "status" = 'QUEUED'::"BackgroundJobStatus"
            ORDER BY "createdAt" ASC
            LIMIT 1
          `;

          const job = rows[0];

          if (!job) {
            break;
          }

          const claimed = await this.prisma.$executeRaw`
            UPDATE "BackgroundJob"
            SET
              "status" = 'RUNNING'::"BackgroundJobStatus",
              "startedAt" = NOW(),
              "attempts" = "attempts" + 1,
              "error" = NULL,
              "updatedAt" = NOW()
            WHERE "id" = ${job.id}
            AND "status" = 'QUEUED'::"BackgroundJobStatus"
          `;

          if (!claimed) {
            continue;
          }

          try {
            const payload = this.parsePayload(job.payload);
            const result =
              payload.type === 'chat'
                ? await this.copilot.chat(payload.dto)
                : await this.generateMarketingPlan(payload.dto);
            const resultJson = JSON.stringify(result);

            await this.prisma.$executeRaw`
              UPDATE "BackgroundJob"
              SET
                "status" = 'SUCCEEDED'::"BackgroundJobStatus",
                "result" = ${resultJson}::jsonb,
                "completedAt" = NOW(),
                "updatedAt" = NOW()
              WHERE "id" = ${job.id}
            `;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Unknown Copilot job error';

            this.logger.error(`Copilot job ${job.id} failed: ${message}`);

            await this.prisma.$executeRaw`
              UPDATE "BackgroundJob"
              SET
                "status" = 'FAILED'::"BackgroundJobStatus",
                "error" = ${message},
                "completedAt" = NOW(),
                "updatedAt" = NOW()
              WHERE "id" = ${job.id}
            `;
          }
        }
      } while (this.wakeupRequested);
    } finally {
      this.processing = false;
    }
  }

  private parsePayload(payload: unknown): CopilotPayload {
    const value =
      typeof payload === 'string' ? JSON.parse(payload) : payload;

    if (!value || typeof value !== 'object') {
      throw new Error('Invalid Copilot job payload.');
    }

    const candidate = value as CopilotPayload;

    if (candidate.type !== 'chat' && candidate.type !== 'marketing-plan') {
      throw new Error('Unsupported Copilot job payload.');
    }

    return candidate;
  }

  private async generateMarketingPlan(dto: CreateMarketingPlanDto) {
    const conversation = await this.conversations.ensureConversation({
      conversationId: dto.conversationId,
      campaignId: dto.campaignId,
      mode: 'marketing-plan',
      firstMessage: dto.prompt,
    });

    await this.conversations.appendUserMessage(conversation.id, dto.prompt);

    const plan = await this.planner.generate(dto);

    const summary = [
      `Marketing Plan: ${plan.campaignName}`,
      `Objective: ${plan.objective}`,
      `Audience: ${plan.audience}`,
      `Hook: ${plan.hook}`,
      `Key Message: ${plan.keyMessage}`,
    ].join('\n');

    await this.conversations.appendAssistantMessage(conversation.id, summary, {
      mode: 'marketing-plan',
      campaignName: plan.campaignName,
      marketingPlan: plan,
    });

    return {
      ...plan,
      conversation: {
        id: conversation.id,
        title: conversation.title,
      },
    };
  }

  private publicJob(job: BackgroundJobRow) {
    return {
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
