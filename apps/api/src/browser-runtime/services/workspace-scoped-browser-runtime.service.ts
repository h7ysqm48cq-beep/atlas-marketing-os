import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BrowserAccountService } from './browser-account.service';
import { BrowserAutomationPolicyService } from './browser-automation-policy.service';
import { BrowserLeaseService } from './browser-lease.service';
import { BrowserOnboardingService } from './browser-onboarding.service';
import { BrowserSessionService } from './browser-session.service';
import { BrowserTimelineService } from './browser-timeline.service';

@Injectable()
export class WorkspaceScopedBrowserLeaseService extends BrowserLeaseService {
  constructor(
    prisma: PrismaService,
    private readonly scopedAccounts: BrowserAccountService,
  ) {
    super(prisma, scopedAccounts);
  }

  override async acquire(browserAccountId: string, input: any): Promise<any> {
    await this.scopedAccounts.getById(browserAccountId);
    return super.acquire(browserAccountId, input);
  }

  override async release(browserAccountId: string, input: any): Promise<any> {
    await this.scopedAccounts.getById(browserAccountId);
    return super.release(browserAccountId, input);
  }

  override async status(browserAccountId: string): Promise<any> {
    await this.scopedAccounts.getById(browserAccountId);
    return super.status(browserAccountId);
  }
}

@Injectable()
export class WorkspaceScopedBrowserTimelineService {
  private readonly base: BrowserTimelineService;

  constructor(
    prisma: PrismaService,
    private readonly scopedAccounts: BrowserAccountService,
  ) {
    this.base = new BrowserTimelineService(prisma);
  }

  async record(input: Parameters<BrowserTimelineService['record']>[0]) {
    await this.scopedAccounts.getById(input.accountId);
    return this.base.record(input);
  }

  async list(accountId: string, limit = 100) {
    await this.scopedAccounts.getById(accountId);
    return this.base.list(accountId, limit);
  }
}

@Injectable()
export class WorkspaceScopedBrowserAutomationPolicyService extends BrowserAutomationPolicyService {
  constructor(
    prisma: PrismaService,
    private readonly scopedAccounts: BrowserAccountService,
  ) {
    super(prisma);
  }

  override async getOrCreate(accountId: string): Promise<any> {
    await this.scopedAccounts.getById(accountId);
    return super.getOrCreate(accountId);
  }
}

@Injectable()
export class WorkspaceScopedBrowserOnboardingService extends BrowserOnboardingService {
  constructor(
    prisma: PrismaService,
    private readonly scopedAccounts: BrowserAccountService,
    sessions: BrowserSessionService,
    policies: BrowserAutomationPolicyService,
    timeline: BrowserTimelineService,
  ) {
    super(prisma, scopedAccounts, sessions, policies, timeline);
  }

  override async run(accountId: string, input?: any): Promise<any> {
    await this.scopedAccounts.getById(accountId);
    return super.run(accountId, input);
  }
}
