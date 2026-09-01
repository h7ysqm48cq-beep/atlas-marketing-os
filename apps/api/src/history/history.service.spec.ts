import { BrandsService } from '../brands/brands.service';
import { HistoryService } from './history.service';

describe('HistoryService workspace scope', () => {
  const createService = () => {
    const prisma = {
      generationHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
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
    const service = new HistoryService(prisma, brands);

    return {
      prisma,
      brands,
      service,
    };
  };

  it('lists only generation history for the active brand', async () => {
    const { prisma, service } = createService();

    await service.list();

    expect(prisma.generationHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          brandId: 'brand-a',
        },
      }),
    );
  });

  it('does not return generation history from another brand/workspace', async () => {
    const { prisma, service } = createService();
    prisma.generationHistory.findFirst.mockResolvedValue(null);
    prisma.generationHistory.findUnique.mockResolvedValue({
      id: 'history-b',
      brandId: 'brand-b',
    });

    await expect(service.get('history-b')).rejects.toThrow(
      'Generation history record not found.',
    );

    expect(prisma.generationHistory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'history-b',
          brandId: 'brand-a',
        },
      }),
    );
  });
});
