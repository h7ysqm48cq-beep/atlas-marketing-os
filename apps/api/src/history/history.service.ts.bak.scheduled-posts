import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UpdateFavoriteDto } from './dto/update-favorite.dto';
import { UpdateHistoryStatusDto } from './dto/update-history-status.dto';

type SaveGenerationInput = {
  brandId: string;
  campaignId?: string;
  ideaId?: string;
  topic: string;
  platforms: string[];
  style: string;
  language: string;
  facebook: string;
  telegram: string;
  reels: string;
  imagePrompt: string;
  analysis: Record<string, unknown>;
};

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.generationHistory.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            workspace: { select: { id: true, name: true, slug: true } },
          },
        },
        campaign: { select: { id: true, name: true } },
        idea: { select: { id: true, title: true, sortOrder: true } },
      },
    });
  }

  async get(id: string) {
    const record = await this.prisma.generationHistory.findUnique({
      where: { id },
      include: {
        brand: { include: { workspace: true } },
        campaign: true,
        idea: true,
      },
    });

    if (!record) {
      throw new NotFoundException('Generation history record not found.');
    }

    return record;
  }

  save(input: SaveGenerationInput) {
    return this.prisma.generationHistory.create({
      data: {
        brandId: input.brandId,
        campaignId: input.campaignId,
        ideaId: input.ideaId,
        topic: input.topic,
        platforms: input.platforms,
        style: input.style,
        language: input.language,
        facebook: input.facebook,
        telegram: input.telegram,
        reels: input.reels,
        imagePrompt: input.imagePrompt,
        analysis: input.analysis as Prisma.InputJsonValue,
        status: ContentStatus.DRAFT,
      },
    });
  }

  async updateFavorite(id: string, dto: UpdateFavoriteDto) {
    await this.get(id);
    return this.prisma.generationHistory.update({
      where: { id },
      data: { isFavorite: dto.isFavorite },
    });
  }

  async updateStatus(id: string, dto: UpdateHistoryStatusDto) {
    await this.get(id);
    const now = new Date();

    return this.prisma.generationHistory.update({
      where: { id },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote,
        reviewedBy: dto.reviewedBy,
        reviewedAt:
          dto.status === ContentStatus.PENDING_REVIEW ||
          dto.status === ContentStatus.APPROVED ||
          dto.status === ContentStatus.REJECTED
            ? now
            : undefined,
        approvedAt:
          dto.status === ContentStatus.APPROVED ? now : undefined,
        publishedAt:
          dto.status === ContentStatus.PUBLISHED ? now : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.generationHistory.delete({ where: { id } });
    return { deleted: true, id };
  }
}
