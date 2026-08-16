import { Test, TestingModule } from '@nestjs/testing';
import { BrandsService } from '../brands/brands.service';
import { PrismaService } from '../database/prisma.service';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService', () => {
  let service: CampaignsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: BrandsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
