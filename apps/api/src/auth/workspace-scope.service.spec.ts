import { NotFoundException } from '@nestjs/common';
import { AuthContextService } from './auth-context.service';
import { WorkspaceScopeService } from './workspace-scope.service';

function prismaMock() {
  return {
    workspace: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    workspaceMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  } as any;
}

describe('WorkspaceScopeService', () => {
  it('prefers the authenticated user default membership', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new WorkspaceScopeService(prisma, auth);

    prisma.workspaceMember.findFirst.mockResolvedValueOnce({
      id: 'member-shared',
      userId: 'user-a',
      workspaceId: 'workspace-shared',
      isDefault: true,
      workspace: { id: 'workspace-shared', slug: 'shared' },
    });

    const workspace = await auth.run('user-a', () => service.getCurrentUserWorkspace());

    expect(workspace.id).toBe('workspace-shared');
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });

  it('backfills membership from a legacy owned workspace without creating another workspace', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new WorkspaceScopeService(prisma, auth);

    prisma.workspaceMember.findFirst.mockResolvedValue(null);
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'workspace-legacy',
      ownerUserId: 'user-a',
    });
    prisma.workspaceMember.upsert.mockResolvedValue({ id: 'member-legacy' });

    const workspace = await auth.run('user-a', () => service.getCurrentUserWorkspace());

    expect(workspace.id).toBe('workspace-legacy');
    expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: 'workspace-legacy',
          userId: 'user-a',
          role: 'OWNER',
          isDefault: true,
        }),
      }),
    );
    expect(prisma.workspace.upsert).not.toHaveBeenCalled();
  });

  it('creates a personal workspace only when membership and legacy ownership are both absent', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new WorkspaceScopeService(prisma, auth);

    prisma.workspaceMember.findFirst.mockResolvedValue(null);
    prisma.workspace.findUnique.mockResolvedValue(null);
    prisma.workspace.upsert.mockResolvedValue({
      id: 'workspace-new',
      ownerUserId: 'user-new',
    });
    prisma.workspaceMember.upsert.mockResolvedValue({ id: 'member-new' });

    const workspace = await auth.run('user-new', () => service.getCurrentUserWorkspace());

    expect(workspace.id).toBe('workspace-new');
    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-new' },
      update: {},
      create: {
        name: 'Atlas Workspace',
        slug: 'atlas-user-new',
        ownerUserId: 'user-new',
      },
    });
  });

  it('fails closed when the authenticated user is not a member of the requested workspace', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new WorkspaceScopeService(prisma, auth);

    prisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(
      auth.run('user-a', () => service.requireWorkspaceAccess('workspace-b')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps unauthenticated system scope on the legacy mgmbetmyr workspace', async () => {
    const prisma = prismaMock();
    const auth = new AuthContextService();
    const service = new WorkspaceScopeService(prisma, auth);

    prisma.workspace.upsert.mockResolvedValue({
      id: 'workspace-system',
      slug: 'mgmbetmyr',
    });

    const workspace = await service.getCurrentWorkspace();

    expect(workspace.id).toBe('workspace-system');
    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: { slug: 'mgmbetmyr' },
      update: {},
      create: { name: 'MGMBETMYR', slug: 'mgmbetmyr' },
    });
  });
});
