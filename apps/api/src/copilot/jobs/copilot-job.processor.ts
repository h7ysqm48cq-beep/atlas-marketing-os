import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CopilotService } from '../copilot.service';

@Injectable()
export class CopilotJobProcessor implements OnModuleInit {
  private readonly logger = new Logger(CopilotJobProcessor.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly copilot: CopilotService,
  ) {}

  onModuleInit() {
    setInterval(() => this.process(), 5000);

    this.logger.log('Copilot job processor started');
  }

  async process() {
    if (this.running) return;

    this.running = true;

    try {
      const jobs = await this.prisma.backgroundJob.findMany({
        where: {
          type: 'COPILOT_CHAT',
          status: 'QUEUED',
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 3,
      });

      for (const job of jobs) {
        await this.prisma.backgroundJob.update({
          where: {
            id: job.id,
          },
          data: {
            status: 'RUNNING',
            startedAt: new Date(),
          },
        });

        try {
          const payload = job.payload as {
            prompt: string;
            conversationId?: string;
          };

          const result = await this.copilot.chat({
            messages: [
              {
                role: 'user',
                content: payload.prompt,
              },
            ],
            conversationId: payload.conversationId,
          } as any);

          await this.prisma.backgroundJob.update({
            where: {
              id: job.id,
            },
            data: {
              status: 'SUCCEEDED',
              result,
              completedAt: new Date(),
            },
          });
        } catch (error) {
          await this.prisma.backgroundJob.update({
            where: {
              id: job.id,
            },
            data: {
              status: 'FAILED',
              error: error instanceof Error ? error.message : String(error),
              completedAt: new Date(),
            },
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Copilot job processor cycle failed: ${message}`,
        stack,
      );
    } finally {
      this.running = false;
    }
  }
}
