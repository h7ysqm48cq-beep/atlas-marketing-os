import { UnauthorizedException } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { AuthContextService } from '../auth/auth-context.service';

function prismaMock() {
  return {
    workspace: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    workspaceMember: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    brand: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as any;
}

describe('workspace isolation', () => {
  it('requires an authenticated user for brand reads', async () => {
    const prisma = prismaMock();
    const service = new BrandsService(prisma, new AuthContextService());

    await expect(service.list()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.brand.findMany).not.toHaveBeenCalled();
  });

  it('prefers the current user default workspace membership over a legacy personal owner workspace', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new BrandsService(prisma, auth);

    prisma.workspaceMember.findFirst.mockResolvedValue({
      workspaceId: 'workspace-shared',
      userId: 'user-a',
      isDefault: true,
      workspace: {
        id: 'workspace-shared',
        ownerUserId: 'shared-owner',
      },
    });
    prisma.workspace.upsert.mockResolvedValue({
      id: 'workspace-personal',
      ownerUserId: 'user-a',
    });
    prisma.brand.findFirst.mockImplementation(({ where }: any) => {
      if (where.workspaceId === 'workspace-shared') {
        return Promise.resolve({
          id: 'brand-shared',
          workspace: { id: 'workspace-shared' },
        });
      }

      return Promise.resolve({
        id: 'brand-personal',
        workspace: { id: 'workspace-personal' },
      });
    });

    const brand = await auth.run('user-a', () => service.getActiveBrand());

    expect(brand).toEqual(
      expect.objectContaining({
        id: 'brand-shared',
      }),
    );
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          isDefault: true,
        },
      }),
    );
    expect(prisma.workspace.upsert).not.toHaveBeenCalled();
  });

  it('creates a separate workspace and starter brand for a new user', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new BrandsService(prisma, auth);
    prisma.workspace.upsert.mockResolvedValue({ id: 'workspace-new', ownerUserId: 'user-new' });
    prisma.brand.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'brand-new' });
    prisma.brand.create.mockResolvedValue({ id: 'brand-new' });

    const brand = await auth.run('user-new', () => service.getActiveBrand());

    expect(brand).toEqual({ id: 'brand-new' });
    expect(prisma.brand.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: 'workspace-new' }) }),
    );
  });

  it('does not return a brand owned by another user', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new BrandsService(prisma, auth);
    prisma.workspace.upsert.mockResolvedValue({ id: 'workspace-a', ownerUserId: 'user-a' });
    prisma.brand.findUnique.mockResolvedValue(null);

    await expect(
      auth.run('user-a', () => service.get('brand-from-user-b')),
    ).rejects.toThrow('Brand not found.');

    expect(prisma.brand.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'brand-from-user-b',
          workspace: { ownerUserId: 'user-a' },
        },
      }),
    );
  });
});
