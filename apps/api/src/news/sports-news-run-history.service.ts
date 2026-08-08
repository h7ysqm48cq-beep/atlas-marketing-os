import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SportsNewsRunHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async acquire(input: { kind: 'morning' | 'evening'; trigger: 'schedule' | 'manual'; timezone: string }) {
    const workspace = await this.prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!workspace) throw new Error('Workspace not found.');
    const local = this.localParts(new Date(), input.timezone);
    const runKey = input.trigger === 'schedule'
      ? `${workspace.id}:${local.date}:${input.kind}:schedule`
      : `${workspace.id}:${local.date}:${input.kind}:manual:${Date.now()}`;
    try {
      const run = await this.prisma.sportsNewsRun.create({ data: { workspaceId: workspace.id, runKey, kind: input.kind, trigger: input.trigger, status: 'RUNNING' } });
      return { acquired: true as const, run };
    } catch (error) {
      if (this.isUniqueViolation(error)) return { acquired: false as const, runKey };
      throw error;
    }
  }

  async complete(id: string, input: { status: string; sourceCount?: number; rejectedSourceCount?: number; scheduledPostIds?: string[]; error?: string | null }) {
    return this.prisma.sportsNewsRun.update({ where: { id }, data: { status: input.status, sourceCount: input.sourceCount ?? 0, rejectedSourceCount: input.rejectedSourceCount ?? 0, scheduledPostIds: input.scheduledPostIds ?? [], error: input.error ?? null, completedAt: new Date() } });
  }

  async recent(limit = 10) {
    const workspace = await this.prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!workspace) return [];
    return this.prisma.sportsNewsRun.findMany({ where: { workspaceId: workspace.id }, orderBy: { startedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 50) });
  }

  private localParts(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}` };
  }

  private isUniqueViolation(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
  }
}
