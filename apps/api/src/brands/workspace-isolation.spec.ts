import { UnauthorizedException } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { AuthContextService } from '../auth/auth-context.service';

function prismaMock() {
  return {
    workspace: {
      findUnique: jest.fn(),
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

  it('queries brands through the current user workspace', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new BrandsService(prisma, auth);
    const workspace = { id: 'workspace-a', ownerUserId: 'user-a' };
    prisma.workspace.upsert.mockResolvedValue(workspace);
    prisma.brand.findFirst.mockResolvedValue({ id: 'brand-a', workspace });

    await auth.run('user-a', () => service.getActiveBrand());

    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-a' },
      update: {},
      create: {
        name: 'Atlas Workspace',
        slug: 'atlas-user-a',
        ownerUserId: 'user-a',
      },
    });
    expect(prisma.brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-a', status: 'ACTIVE' } }),
    );
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
