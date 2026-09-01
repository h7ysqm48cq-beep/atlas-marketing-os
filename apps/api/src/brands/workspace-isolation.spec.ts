import { UnauthorizedException } from '@nestjs/common';
import { AuthContextService } from '../auth/auth-context.service';
import { WorkspaceScopeService } from '../auth/workspace-scope.service';
import { BrandsService } from './brands.service';

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
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

function createServices(prisma: ReturnType<typeof prismaMock>) {
  const auth = new AuthContextService();
  const workspaceScope = new WorkspaceScopeService(prisma, auth);
  const service = new BrandsService(prisma, workspaceScope);

  return {
    auth,
    workspaceScope,
    service,
  };
}

describe('workspace isolation', () => {
  it('requires an authenticated user for brand reads', async () => {
    const prisma = prismaMock();
    const { service } = createServices(prisma);

    await expect(service.list()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.brand.findMany).not.toHaveBeenCalled();
  });

  it('prefers the current user default workspace membership over a legacy personal owner workspace', async () => {
    const prisma = prismaMock();
    const { auth, service } = createServices(prisma);

    prisma.workspaceMember.findFirst.mockResolvedValueOnce({
      id: 'membership-shared',
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
    const { auth, service } = createServices(prisma);

    prisma.workspaceMember.findFirst.mockResolvedValue(null);
    prisma.workspace.findUnique.mockResolvedValue(null);
    prisma.workspace.upsert.mockResolvedValue({
      id: 'workspace-new',
      ownerUserId: 'user-new',
    });
    prisma.workspaceMember.upsert.mockResolvedValue({
      id: 'membership-new',
    });
    prisma.brand.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'brand-new' });
    prisma.brand.create.mockResolvedValue({ id: 'brand-new' });

    const brand = await auth.run('user-new', () => service.getActiveBrand());

    expect(brand).toEqual({ id: 'brand-new' });
    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: {
        ownerUserId: 'user-new',
      },
      update: {},
      create: {
        name: 'Atlas Workspace',
        slug: 'atlas-user-new',
        ownerUserId: 'user-new',
      },
    });
    expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: 'workspace-new',
          userId: 'user-new',
          role: 'OWNER',
          isDefault: true,
        }),
      }),
    );
    expect(prisma.brand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'workspace-new',
        }),
      }),
    );
  });

  it('does not return a brand from a workspace the current user cannot access', async () => {
    const prisma = prismaMock();
    const { auth, service } = createServices(prisma);

    prisma.workspaceMember.findFirst.mockResolvedValueOnce({
      id: 'membership-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      isDefault: true,
      workspace: {
        id: 'workspace-a',
        ownerUserId: 'owner-a',
      },
    });
    prisma.brand.findFirst.mockResolvedValue(null);

    await expect(
      auth.run('user-a', () => service.get('brand-from-workspace-b')),
    ).rejects.toThrow('Brand not found.');

    expect(prisma.brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'brand-from-workspace-b',
          workspaceId: 'workspace-a',
        },
      }),
    );
  });
});
