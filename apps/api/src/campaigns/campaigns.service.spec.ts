import { BrandsService } from '../brands/brands.service';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService workspace scope', () => {
  const createService = () => {
    const prisma = {
      campaign: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as any;
    const brands = {
      getActiveBrand: jest.fn().mockResolvedValue({
        id: 'brand-a',
        workspaceId: 'workspace-a',
      }),
    } as unknown as BrandsService;

    return {
      prisma,
      brands,
      service: new CampaignsService(prisma, brands),
    };
  };

  it('lists only campaigns for the active brand', async () => {
    const { prisma, service } = createService();

    await service.findAll();

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          brandId: 'brand-a',
        },
      }),
    );
  });

  it('does not return a campaign from another brand/workspace', async () => {
    const { prisma, service } = createService();
    prisma.campaign.findFirst.mockResolvedValue(null);
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'campaign-b',
      brandId: 'brand-b',
    });

    await expect(service.findOne('campaign-b')).rejects.toThrow(
      'Campaign not found.',
    );

    expect(prisma.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'campaign-b',
          brandId: 'brand-a',
        },
      }),
    );
  });
});
