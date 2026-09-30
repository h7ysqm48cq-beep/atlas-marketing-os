import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceScopeService } from '../auth/workspace-scope.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScope: WorkspaceScopeService,
  ) {}

  async list() {
    const workspace = await this.workspaceScope.getCurrentUserWorkspace();
    await this.ensureDefaultBrand(workspace.id);

    return this.prisma.brand.findMany({
      where: {
        workspaceId: workspace.id,
        status: 'ACTIVE',
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async get(id: string) {
    const workspace = await this.workspaceScope.getCurrentUserWorkspace();
    const brand = await this.prisma.brand.findFirst({
      where: {
        id,
        workspaceId: workspace.id,
      },
      include: {
        workspace: true,
      },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found.');
    }

    return brand;
  }

  async getActiveBrand() {
    const workspace = await this.workspaceScope.getCurrentWorkspace();
    await this.ensureDefaultBrand(workspace.id);

    const brand = await this.prisma.brand.findFirst({
      where: {
        workspaceId: workspace.id,
        status: 'ACTIVE',
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        workspace: true,
      },
    });

    if (!brand) {
      throw new NotFoundException('No active brand found.');
    }

    return brand;
  }

  async create(dto: CreateBrandDto) {
    const workspace = await this.workspaceScope.getCurrentUserWorkspace();

    return this.prisma.brand.create({
      data: {
        workspaceId: workspace.id,
        ...dto,
      },
    });
  }

  async update(id: string, dto: UpdateBrandDto) {
    await this.get(id);

    return this.prisma.brand.update({
      where: {
        id,
      },
      data: dto,
    });
  }

  private async ensureDefaultBrand(workspaceId: string) {
    const existing = await this.prisma.brand.findFirst({
      where: {
        workspaceId,
        status: 'ACTIVE',
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.brand.create({
      data: {
        workspaceId,
        name: 'MGMBETMYR',
        website: 'https://mgmbetmyr.com',
        industry: 'Entertainment',
        country: 'Malaysia',
        primaryLanguage: 'Chinese and English',
        targetAudience:
          'Malaysian Chinese adults aged 21–45 interested in sports, entertainment, lifestyle and nostalgic content.',
        brandVoice:
          'Natural, warm, locally relevant, premium, conversational and discussion-led.',
        visualStyle:
          'Black and gold, premium cinematic photography, clean composition, small brand placement.',
        contentGoals:
          'Increase meaningful discussion, audience recall, Telegram community growth and consistent brand visibility.',
        callsToAction: [
          'Share your experience',
          'Tell us in the comments',
          'Join our Telegram community',
          'Learn more',
        ],
        keywords: [
          'Malaysia',
          'football',
          'nostalgia',
          'Hong Kong drama',
          'lifestyle',
          'community',
        ],
        forbiddenWords: [
          'guaranteed win',
          '稳赚',
          '100%赢钱',
          'risk-free profit',
        ],
        brandRules: [
          'Avoid hard selling',
          'Lead with a relatable hook',
          'Use one clear discussion question',
          'Keep brand placement subtle',
          'Do not make gambling promises or inducements',
          'Use Malaysian Chinese cultural context when relevant',
        ],
        examplePosts: [
          '有些港剧已经结束很多年，但一句对白，还是能把我们带回小时候。你第一部真正追完的港剧是哪一部？',
        ],
      },
    });
  }
}
