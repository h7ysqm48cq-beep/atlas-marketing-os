import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class CopilotJobService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(payload: {
    prompt: string;
    brandId?: string;
    conversationId?: string;
  }) {
    const job = await this.prisma.backgroundJob.create({
      data: {
        type: 'COPILOT_CHAT',
        status: 'QUEUED',
        payload,
      },
    });

    return {
      jobId: job.id,
      status: job.status,
    };
  }

  async get(id: string) {
    return this.prisma.backgroundJob.findUnique({
      where: {
        id,
      },
    });
  }
}
