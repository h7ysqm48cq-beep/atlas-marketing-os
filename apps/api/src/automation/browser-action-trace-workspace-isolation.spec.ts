import { BrowserActionTraceService } from './browser-action-trace.service';

describe('BrowserActionTraceService workspace isolation', () => {
  function createService(userId: string | null = 'user-a') {
    const prisma = {
      browserActionHistory: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      browserActionTrace: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const authContext = {
      getUserId: jest.fn(() => userId),
    };
    const workspaceScope = {
      getCurrentWorkspaceId: jest.fn().mockResolvedValue('workspace-a'),
    };

    const service = new BrowserActionTraceService(
      prisma as never,
      authContext as never,
      workspaceScope as never,
    );

    return { prisma, workspaceScope, service };
  }

  it('blocks trace creation for a foreign-workspace browser action', async () => {
    const { prisma, service } = createService();
    prisma.browserActionHistory.findFirst.mockResolvedValue(null);

    await expect(
      service.startStep({
        browserActionId: 'action-b',
        stepKey: 'PREPARE',
        stepName: 'Prepare',
        stepOrder: 0,
      }),
    ).rejects.toThrow('Browser Agent action was not found.');

    expect(prisma.browserActionTrace.create).not.toHaveBeenCalled();
  });

  it('blocks mutation of a foreign-workspace trace', async () => {
    const { prisma, service } = createService();
    prisma.browserActionTrace.findFirst.mockResolvedValue(null);

    await expect(service.succeedStep('trace-b')).rejects.toThrow(
      'Browser execution trace step was not found.',
    );

    expect(prisma.browserActionTrace.update).not.toHaveBeenCalled();
  });

  it('scopes flow trace reads through browser action channel workspace', async () => {
    const { prisma, service } = createService();

    await service.listForFlow('flow-a');

    expect(prisma.browserActionTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          browserAction: {
            flowId: 'flow-a',
            channel: {
              workspaceId: 'workspace-a',
            },
          },
        },
      }),
    );
  });

  it('preserves no-user trusted internal action access', async () => {
    const { prisma, service, workspaceScope } = createService(null);
    prisma.browserActionHistory.findUnique.mockResolvedValue({
      id: 'action-b',
    });
    prisma.browserActionTrace.create.mockResolvedValue({
      id: 'trace-internal',
    });

    await expect(
      service.startStep({
        browserActionId: 'action-b',
        stepKey: 'INTERNAL',
        stepName: 'Internal',
        stepOrder: 0,
      }),
    ).resolves.toEqual({
      id: 'trace-internal',
    });

    expect(workspaceScope.getCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(prisma.browserActionHistory.findFirst).not.toHaveBeenCalled();
    expect(prisma.browserActionHistory.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'action-b',
      },
      select: {
        id: true,
      },
    });
  });
});
