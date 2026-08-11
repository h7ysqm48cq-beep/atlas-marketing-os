import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from '../../brands/brands.service';
import { PrismaService } from '../../database/prisma.service';
import {
  LeadActivityType,
  LeadStatus,
  Prisma,
} from '../../generated/prisma/client';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadScoringService } from './lead-scoring.service';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandsService: BrandsService,
    private readonly scoring: LeadScoringService,
  ) {}

  async create(dto: CreateLeadDto) {
    const brand = await this.brandsService.getActiveBrand();

    const email = this.normalizeEmail(dto.email);
    const phone = this.normalizePhone(dto.phone);

    const duplicate = await this.findDuplicate(
      brand.id,
      email,
      phone,
      dto.sourcePlatform,
      dto.externalId,
    );

    if (duplicate) {
      return {
        created: false,
        duplicate: true,
        lead: duplicate,
      };
    }

    await this.validateRelations(
      brand.id,
      dto.audienceSegmentId,
      dto.sourceCampaignId,
    );

    const lead = await this.prisma.lead.create({
      data: {
        workspaceId: brand.workspaceId,
        brandId: brand.id,

        audienceSegmentId: dto.audienceSegmentId,
        sourceCampaignId: dto.sourceCampaignId,

        name: this.clean(dto.name),
        email,
        phone,
        company: this.clean(dto.company),
        industry: this.clean(dto.industry),

        country: this.clean(dto.country) ?? brand.country,
        region: this.clean(dto.region),
        language: this.clean(dto.language) ?? brand.primaryLanguage,

        source: this.clean(dto.source),
        sourcePlatform: this.clean(dto.sourcePlatform),
        externalId: this.clean(dto.externalId),

        status: dto.status ?? LeadStatus.NEW,
        score: dto.score ?? this.scoring.getDefaultScore(),

        tags: dto.tags ?? [],

        consentStatus: dto.consentStatus,
        consentSource: this.clean(dto.consentSource),
        consentAt: dto.consentStatus === 'GRANTED' ? new Date() : undefined,

        metadata: dto.metadata as Prisma.InputJsonValue | undefined,

        activities: {
          create: {
            type: LeadActivityType.CREATED,
            source: dto.source ?? 'atlas',
            title: 'Lead created',
          },
        },
      },
      include: this.include(),
    });

    return {
      created: true,
      duplicate: false,
      lead,
    };
  }

  async findAll(status?: LeadStatus, search?: string) {
    const brand = await this.brandsService.getActiveBrand();

    const cleanSearch = search?.trim();

    return this.prisma.lead.findMany({
      where: {
        brandId: brand.id,
        status,
        ...(cleanSearch
          ? {
              OR: [
                {
                  name: {
                    contains: cleanSearch,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: cleanSearch,
                    mode: 'insensitive',
                  },
                },
                {
                  phone: {
                    contains: cleanSearch,
                  },
                },
                {
                  company: {
                    contains: cleanSearch,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
      include: this.include(),
    });
  }

  async findOne(id: string) {
    const brand = await this.brandsService.getActiveBrand();

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        brandId: brand.id,
      },
      include: {
        ...this.include(),
        activities: {
          orderBy: {
            occurredAt: 'desc',
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.findOne(id);

    await this.validateRelations(
      existing.brandId,
      dto.audienceSegmentId,
      dto.sourceCampaignId,
    );

    const email =
      dto.email === undefined ? undefined : this.normalizeEmail(dto.email);

    const phone =
      dto.phone === undefined ? undefined : this.normalizePhone(dto.phone);

    if (
      email !== undefined ||
      phone !== undefined ||
      dto.externalId !== undefined ||
      dto.sourcePlatform !== undefined
    ) {
      const duplicate = await this.findDuplicate(
        existing.brandId,
        email ?? existing.email,
        phone ?? existing.phone,
        dto.sourcePlatform ?? existing.sourcePlatform ?? undefined,
        dto.externalId ?? existing.externalId ?? undefined,
        id,
      );

      if (duplicate) {
        throw new BadRequestException(
          'Another lead already uses this identity.',
        );
      }
    }

    const statusChanged =
      dto.status !== undefined && dto.status !== existing.status;

    const converted =
      dto.status === LeadStatus.CONVERTED &&
      existing.status !== LeadStatus.CONVERTED;

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        name: dto.name === undefined ? undefined : this.clean(dto.name),

        email,
        phone,

        company:
          dto.company === undefined ? undefined : this.clean(dto.company),

        industry:
          dto.industry === undefined ? undefined : this.clean(dto.industry),

        country:
          dto.country === undefined ? undefined : this.clean(dto.country),

        region: dto.region === undefined ? undefined : this.clean(dto.region),

        language:
          dto.language === undefined ? undefined : this.clean(dto.language),

        source: dto.source === undefined ? undefined : this.clean(dto.source),

        sourcePlatform:
          dto.sourcePlatform === undefined
            ? undefined
            : this.clean(dto.sourcePlatform),

        externalId:
          dto.externalId === undefined ? undefined : this.clean(dto.externalId),

        audienceSegmentId: dto.audienceSegmentId,
        sourceCampaignId: dto.sourceCampaignId,

        status: dto.status,
        score:
          dto.score === undefined ? undefined : this.scoring.clamp(dto.score),

        tags: dto.tags,

        consentStatus: dto.consentStatus,

        consentSource:
          dto.consentSource === undefined
            ? undefined
            : this.clean(dto.consentSource),

        consentAt:
          dto.consentStatus === 'GRANTED' && !existing.consentAt
            ? new Date()
            : dto.consentStatus === 'REVOKED'
              ? null
              : undefined,

        convertedAt: converted
          ? new Date()
          : dto.status && dto.status !== LeadStatus.CONVERTED
            ? null
            : undefined,

        metadata:
          dto.metadata === undefined
            ? undefined
            : (dto.metadata as Prisma.InputJsonValue),
      },
      include: this.include(),
    });

    if (statusChanged) {
      await this.prisma.leadActivity.create({
        data: {
          leadId: id,
          type: converted
            ? LeadActivityType.CONVERTED
            : LeadActivityType.STATUS_CHANGED,
          source: 'atlas',
          title: converted ? 'Lead converted' : 'Lead status changed',
          description: `${existing.status} → ${lead.status}`,
        },
      });
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.lead.delete({
      where: { id },
    });

    return {
      deleted: true,
      id,
    };
  }

  async addActivity(id: string, dto: CreateLeadActivityDto) {
    const lead = await this.findOne(id);

    const delta = dto.scoreDelta ?? this.scoring.getActivityDelta(dto.type);

    const nextScore = this.scoring.clamp(lead.score + delta);

    const shouldQualify =
      nextScore >= 60 &&
      lead.status !== LeadStatus.QUALIFIED &&
      lead.status !== LeadStatus.CONVERTED;

    const activity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leadActivity.create({
        data: {
          leadId: id,
          type: dto.type,
          channel: this.clean(dto.channel),
          source: this.clean(dto.source),
          title: this.clean(dto.title),
          description: this.clean(dto.description),
          scoreDelta: delta,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await tx.lead.update({
        where: { id },
        data: {
          score: nextScore,
          lastInteractionAt: new Date(),
          status: shouldQualify ? LeadStatus.QUALIFIED : undefined,
        },
      });

      if (shouldQualify) {
        await tx.leadActivity.create({
          data: {
            leadId: id,
            type: LeadActivityType.QUALIFIED,
            source: 'atlas-scoring',
            title: 'Lead automatically qualified',
            description: `Score reached ${nextScore}`,
          },
        });
      }

      return created;
    });

    return {
      activity,
      lead: await this.findOne(id),
    };
  }

  async getActivities(id: string) {
    await this.findOne(id);

    return this.prisma.leadActivity.findMany({
      where: {
        leadId: id,
      },
      orderBy: {
        occurredAt: 'desc',
      },
    });
  }

  private async findDuplicate(
    brandId: string,
    email?: string | null,
    phone?: string | null,
    sourcePlatform?: string,
    externalId?: string,
    excludeId?: string,
  ) {
    const identities: Prisma.LeadWhereInput[] = [];

    if (email) {
      identities.push({ email });
    }

    if (phone) {
      identities.push({ phone });
    }

    if (sourcePlatform && externalId) {
      identities.push({
        sourcePlatform,
        externalId,
      });
    }

    if (!identities.length) {
      return null;
    }

    return this.prisma.lead.findFirst({
      where: {
        brandId,
        ...(excludeId
          ? {
              id: {
                not: excludeId,
              },
            }
          : {}),
        OR: identities,
      },
      include: this.include(),
    });
  }

  private async validateRelations(
    brandId: string,
    audienceSegmentId?: string,
    sourceCampaignId?: string,
  ) {
    if (audienceSegmentId) {
      const audience = await this.prisma.audienceSegment.findFirst({
        where: {
          id: audienceSegmentId,
          brandId,
        },
        select: {
          id: true,
        },
      });

      if (!audience) {
        throw new BadRequestException(
          'Audience segment does not belong to active brand.',
        );
      }
    }

    if (sourceCampaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: {
          id: sourceCampaignId,
          brandId,
        },
        select: {
          id: true,
        },
      });

      if (!campaign) {
        throw new BadRequestException(
          'Campaign does not belong to active brand.',
        );
      }
    }
  }

  private include() {
    return {
      audienceSegment: {
        select: {
          id: true,
          name: true,
        },
      },
      sourceCampaign: {
        select: {
          id: true,
          name: true,
        },
      },
    } satisfies Prisma.LeadInclude;
  }

  private normalizeEmail(value?: string | null): string | undefined {
    const result = value?.trim().toLowerCase();
    return result || undefined;
  }

  private normalizePhone(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');

    if (!digits) {
      return undefined;
    }

    return hasPlus ? `+${digits}` : digits;
  }

  private clean(value?: string | null): string | undefined {
    const result = value?.trim();
    return result || undefined;
  }
}
