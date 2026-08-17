import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client';
import {
  BackgroundJobStatus,
  BackgroundJobType,
} from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { ChatCopilotDto } from './dto/chat-copilot.dto';
import { CreateMarketingPlanDto } from './dto/create-marketing-plan.dto';
import { ConversationMemoryService } from './conversation-memory.service';
import { CopilotService } from './copilot.service';
import { MarketingPlannerService } from './marketing-planner.service';

type CopilotPayload =
  | { type: 'chat'; dto: ChatCopilotDto }
  | { type: 'marketing-plan'; dto: CreateMarketingPlanDto };

@Injectable()
export class CopilotBackgroundJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CopilotBackgroundJobService.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly copilot: CopilotService,
    private readonly planner: MarketingPlannerService,
    private readonly conversations: ConversationMemoryService,
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.backgroundJob.updateMany({
      where: {
        type: {
          in: [
            BackgroundJobType.COPILOT_CHAT,
            BackgroundJobType.COPILOT_MARKETING_PLAN,
          ],
        },
        status: BackgroundJobStatus.RUNNING,
      },
      data: { status: BackgroundJobStatus.QUEUED },
    });
    void this.processQueue();
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
    const job = await this.prisma.backgroundJob.findFirstOrThrow({
      where: {
        id,
        type: {
          in: [
            BackgroundJobType.COPILOT_CHAT,
            BackgroundJobType.COPILOT_MARKETING_PLAN,
          ],
        },
      },
    });
    return this.publicJob(job);
  }

  @Interval(5000)
  processPending() {
    void this.processQueue();
  }

  private async enqueue(payload: CopilotPayload) {
    const type = payload.type === 'chat'
      ? BackgroundJobType.COPILOT_CHAT
      : BackgroundJobType.COPILOT_MARKETING_PLAN;
    const job = await this.prisma.backgroundJob.create({
      data: {
        type,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    void this.processQueue();
    return this.publicJob(job);
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const job = await this.prisma.backgroundJob.findFirst({
          where: {
            type: {
              in: [
                BackgroundJobType.COPILOT_CHAT,
                BackgroundJobType.COPILOT_MARKETING_PLAN,
              ],
            },
            status: BackgroundJobStatus.QUEUED,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (!job) break;

        const claimed = await this.prisma.backgroundJob.updateMany({
          where: { id: job.id, status: BackgroundJobStatus.QUEUED },
          data: {
            status: BackgroundJobStatus.RUNNING,
            startedAt: new Date(),
            attempts: { increment: 1 },
            error: null,
          },
        });
        if (!claimed.count) continue;

        try {
          const payload = job.payload as unknown as CopilotPayload;
          const result = payload.type === 'chat'
            ? await this.copilot.chat(payload.dto)
            : await this.generateMarketingPlan(payload.dto);

          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: BackgroundJobStatus.SUCCEEDED,
              result: JSON.parse(
                JSON.stringify(result),
              ) as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Copilot job ${job.id} failed: ${message}`);
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: BackgroundJobStatus.FAILED,
              error: message,
              completedAt: new Date(),
            },
          });
        }
      }
    } finally {
      this.processing = false;
    }
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
      conversation: { id: conversation.id, title: conversation.title },
    };
  }

  private publicJob(job: {
    id: string;
    status: BackgroundJobStatus;
    result: Prisma.JsonValue | null;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
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
