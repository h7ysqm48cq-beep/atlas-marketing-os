jest.mock('./browser-session.service', () => ({
  BrowserSessionService: class BrowserSessionService {},
}));

import { NotFoundException } from '@nestjs/common';
import {
  WorkspaceScopedBrowserAutomationPolicyService,
  WorkspaceScopedBrowserLeaseService,
  WorkspaceScopedBrowserOnboardingService,
  WorkspaceScopedBrowserTimelineService,
} from './workspace-scoped-browser-runtime.service';

describe('Browser Runtime workspace scope', () => {
  const crossWorkspaceAccount = () => ({
    getById: jest
      .fn()
      .mockRejectedValue(new NotFoundException('Browser account was not found.')),
  });

  it('checks browser-account scope before acquiring a lease', async () => {
    const prisma = {
      $transaction: jest.fn().mockResolvedValue({ acquired: true }),
    } as any;
    const browserAccounts = crossWorkspaceAccount();
    const service = new WorkspaceScopedBrowserLeaseService(
      prisma,
      browserAccounts as any,
    );

    await expect(
      service.acquire('account-b', {
        ownerKey: 'workspace-a-worker',
      }),
    ).rejects.toThrow('Browser account was not found.');

    expect(browserAccounts.getById).toHaveBeenCalledWith('account-b');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('checks browser-account scope before returning timeline events', async () => {
    const prisma = {
      browserAccountEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const browserAccounts = crossWorkspaceAccount();
    const service = new WorkspaceScopedBrowserTimelineService(
      prisma,
      browserAccounts as any,
    );

    await expect(service.list('account-b')).rejects.toThrow(
      'Browser account was not found.',
    );

    expect(browserAccounts.getById).toHaveBeenCalledWith('account-b');
    expect(prisma.browserAccountEvent.findMany).not.toHaveBeenCalled();
  });

  it('checks browser-account scope before reading automation policy', async () => {
    const prisma = {
      browserAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'account-b' }),
      },
      browserAutomationPolicy: {
        upsert: jest.fn().mockResolvedValue({ browserAccountId: 'account-b' }),
      },
    } as any;
    const browserAccounts = crossWorkspaceAccount();
    const service = new WorkspaceScopedBrowserAutomationPolicyService(
      prisma,
      browserAccounts as any,
    );

    await expect(service.getOrCreate('account-b')).rejects.toThrow(
      'Browser account was not found.',
    );

    expect(browserAccounts.getById).toHaveBeenCalledWith('account-b');
    expect(prisma.browserAutomationPolicy.upsert).not.toHaveBeenCalled();
  });

  it('checks browser-account scope before onboarding starts', async () => {
    const prisma = {
      browserAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const browserAccounts = crossWorkspaceAccount();
    const service = new WorkspaceScopedBrowserOnboardingService(
      prisma,
      browserAccounts as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.run('account-b')).rejects.toThrow(
      'Browser account was not found.',
    );

    expect(browserAccounts.getById).toHaveBeenCalledWith('account-b');
  });
});
