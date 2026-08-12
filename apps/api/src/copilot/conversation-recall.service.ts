import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ConversationRecallService {
  constructor(private readonly prisma: PrismaService) {}

  async search(input: {
    query: string;
    limit?: number;
    excludeConversationId?: string;
  }) {
    const keyword = input.query?.replace(/\s+/g, ' ').trim().slice(0, 100);

    if (!keyword) {
      return [];
    }

    const limit = Math.min(Math.max(input.limit || 5, 1), 10);

    const conversations = await this.prisma.copilotConversation.findMany({
      where: {
        isArchived: false,
        id: input.excludeConversationId
          ? {
              not: input.excludeConversationId,
            }
          : undefined,
        messages: {
          some: {
            content: {
              contains: keyword,
              mode: 'insensitive',
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
        mode: true,
        updatedAt: true,
        messages: {
          select: {
            role: true,
            content: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 8,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: limit,
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      mode: conversation.mode,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.reverse().slice(-6),
    }));
  }
}
