import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { MemoryFactExtractorService } from '../memory/memory-fact-extractor.service';
import { CopilotMessageRole } from '../generated/prisma/client';

type CreateConversationInput = {
  campaignId?: string;
  mode?: string;
  firstMessage?: string;
};

@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
    private readonly memoryExtractor: MemoryFactExtractorService,
  ) {}

  async create(input: CreateConversationInput = {}) {
    const brand = await this.brands.getActiveBrand();

    if (input.campaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          brandId: brand.id,
        },
        select: {
          id: true,
        },
      });

      if (!campaign) {
        throw new NotFoundException('Campaign not found.');
      }
    }

    return this.prisma.copilotConversation.create({
      data: {
        brandId: brand.id,
        campaignId: input.campaignId,
        mode: input.mode || 'chat',
        title: this.createTitle(input.firstMessage),
      },
      select: this.conversationSummarySelect(),
    });
  }

  async list() {
    const brand = await this.brands.getActiveBrand();

    return this.prisma.copilotConversation.findMany({
      where: {
        brandId: brand.id,
        isArchived: false,
      },
      select: {
        ...this.conversationSummarySelect(),
        _count: {
          select: {
            messages: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 100,
    });
  }

  async get(conversationId: string) {
    const brand = await this.brands.getActiveBrand();

    const conversation = await this.prisma.copilotConversation.findFirst({
      where: {
        id: conversationId,
        brandId: brand.id,
        isArchived: false,
      },
      select: {
        ...this.conversationSummarySelect(),
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            metadata: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    return conversation;
  }

  async ensureConversation(input: {
    conversationId?: string;
    campaignId?: string;
    mode?: string;
    firstMessage: string;
  }) {
    if (!input.conversationId) {
      return this.create({
        campaignId: input.campaignId,
        mode: input.mode,
        firstMessage: input.firstMessage,
      });
    }

    const brand = await this.brands.getActiveBrand();

    const conversation = await this.prisma.copilotConversation.findFirst({
      where: {
        id: input.conversationId,
        brandId: brand.id,
        isArchived: false,
      },
      select: this.conversationSummarySelect(),
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    if (input.campaignId && conversation.campaignId !== input.campaignId) {
      throw new NotFoundException(
        'Conversation does not belong to the selected campaign.',
      );
    }

    return conversation;
  }

  async appendUserMessage(
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    const message = await this.appendMessage(
      conversationId,
      CopilotMessageRole.USER,
      content,
      metadata,
    );

    try {
      await this.memoryExtractor.extractFromMessage({
        message: content,
        sourceId: message.id,
        conversationId,
      });
    } catch (error) {
      this.logger.warn(
        `Memory extraction skipped: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return message;
  }

  async appendAssistantMessage(
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.appendMessage(
      conversationId,
      CopilotMessageRole.ASSISTANT,
      content,
      metadata,
    );
  }

  async recentMessages(conversationId: string, limit = 20) {
    const messages = await this.prisma.copilotConversationMessage.findMany({
      where: {
        conversationId,
      },
      select: {
        role: true,
        content: true,
        metadata: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: Math.min(Math.max(limit, 1), 50),
    });

    return messages.reverse().map((message) => ({
      role:
        message.role === CopilotMessageRole.ASSISTANT
          ? ('assistant' as const)
          : ('user' as const),

      content:
        message.metadata &&
        typeof message.metadata === 'object' &&
        'type' in message.metadata &&
        message.metadata.type === 'marketing-plan' &&
        'plan' in message.metadata
          ? `${message.content}

Current Marketing Plan Context:
${JSON.stringify(message.metadata.plan, null, 2)}`
          : message.content,
    }));
  }

  async rename(conversationId: string, title: string) {
    const brand = await this.brands.getActiveBrand();

    const cleanTitle = title.replace(/\s+/g, ' ').trim();

    if (!cleanTitle) {
      throw new BadRequestException('Conversation title cannot be empty.');
    }

    if (cleanTitle.length > 80) {
      throw new BadRequestException(
        'Conversation title cannot exceed 80 characters.',
      );
    }

    const conversation = await this.prisma.copilotConversation.findFirst({
      where: {
        id: conversationId,
        brandId: brand.id,
        isArchived: false,
      },
      select: {
        id: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    return this.prisma.copilotConversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        title: cleanTitle,
      },
      select: this.conversationSummarySelect(),
    });
  }

  async delete(conversationId: string) {
    const brand = await this.brands.getActiveBrand();

    const conversation = await this.prisma.copilotConversation.findFirst({
      where: {
        id: conversationId,
        brandId: brand.id,
      },
      select: {
        id: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    await this.prisma.copilotConversation.delete({
      where: {
        id: conversation.id,
      },
    });

    return {
      deleted: true,
      id: conversation.id,
    };
  }

  private async appendMessage(
    conversationId: string,
    role: CopilotMessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    const cleanContent = content.trim();

    if (!cleanContent) {
      throw new Error('Conversation message cannot be empty.');
    }

    const message = await this.prisma.copilotConversationMessage.create({
      data: {
        conversationId,
        role,
        content: cleanContent,
        metadata: metadata as any,
      },
      select: {
        id: true,
        role: true,
        content: true,
        metadata: true,
        createdAt: true,
      },
    });

    await this.prisma.copilotConversation.update({
      where: {
        id: conversationId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    return message;
  }

  private createTitle(firstMessage?: string): string {
    const text =
      firstMessage?.replace(/\s+/g, ' ').trim() || 'New conversation';

    if (text.length <= 48) {
      return text;
    }

    return `${text.slice(0, 45)}...`;
  }

  private conversationSummarySelect() {
    return {
      id: true,
      brandId: true,
      campaignId: true,
      title: true,
      mode: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  async searchPreviousContext(query: string, limit = 3) {
    const brand = await this.brands.getActiveBrand();

    const keyword = query.replace(/\s+/g, ' ').trim();

    if (!keyword) {
      return '';
    }

    const conversations = await this.prisma.copilotConversation.findMany({
      where: {
        brandId: brand.id,
        isArchived: false,
        messages: {
          some: {
            content: {
              contains: keyword.slice(0, 20),
              mode: 'insensitive',
            },
          },
        },
      },
      select: {
        title: true,
        messages: {
          select: {
            role: true,
            content: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 6,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: limit,
    });

    if (!conversations.length) {
      return '';
    }

    return [
      'ELENA PREVIOUS CHAT MEMORY',
      '',
      ...conversations.flatMap((conversation) => [
        `Conversation: ${conversation.title}`,
        ...conversation.messages
          .reverse()
          .map(
            (message) => `- ${message.role}: ${message.content.slice(0, 300)}`,
          ),
        '',
      ]),
      'Use previous chats only when relevant.',
    ].join('\n');
  }
}
