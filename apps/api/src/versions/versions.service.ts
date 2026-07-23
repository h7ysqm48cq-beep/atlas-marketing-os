import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateVersionDto } from './dto/create-version.dto';

@Injectable()
export class VersionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVersionDto) {
    const history = await this.prisma.generationHistory.findUnique({
      where: { id: dto.historyId },
      select: { id: true },
    });

    if (!history) {
      throw new NotFoundException('Generation history record not found.');
    }

    const latest = await this.prisma.contentVersion.findFirst({
      where: {
        historyId: dto.historyId,
        platform: dto.platform,
      },
      orderBy: {
        versionNumber: 'desc',
      },
      select: {
        versionNumber: true,
      },
    });

    const versionNumber =
      dto.versionNumber ?? (latest?.versionNumber ?? 0) + 1;

    return this.prisma.contentVersion.create({
      data: {
        historyId: dto.historyId,
        platform: dto.platform,
        content: dto.content,
        sourceAction: dto.sourceAction || 'replace',
        versionNumber,
      },
    });
  }

  list(historyId: string, platform?: string) {
    return this.prisma.contentVersion.findMany({
      where: {
        historyId,
        platform: platform || undefined,
      },
      orderBy: [
        {
          platform: 'asc',
        },
        {
          versionNumber: 'desc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const version = await this.prisma.contentVersion.findUnique({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException('Content version not found.');
    }

    return version;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.contentVersion.delete({
      where: { id },
    });

    return {
      deleted: true,
      id,
    };
  }
}
