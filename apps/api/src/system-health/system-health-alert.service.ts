import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../notifications/notification.service';
import { SystemHealthService } from './system-health.service';

type HealthIssue = {
  code?: string;
  severity?: string;
  count?: number;
  editions?: string[];
  message?: string | null;
};

export function criticalIssueFingerprint(issues: HealthIssue[]) {
  return issues
    .filter((issue) => issue.severity === 'critical')
    .map((issue) =>
      [
        issue.code ?? 'unknown',
        issue.count ?? '',
        Array.isArray(issue.editions) ? [...issue.editions].sort().join(',') : '',
        issue.message ?? '',
      ].join(':'),
    )
    .sort()
    .join('|');
}

function criticalIssueSummary(issues: HealthIssue[]) {
  return issues
    .filter((issue) => issue.severity === 'critical')
    .map((issue) => {
      const label = issue.code ?? 'unknown';
      const editions =
        Array.isArray(issue.editions) && issue.editions.length > 0
          ? ` (${issue.editions.join(', ')})`
          : '';
      const count =
        typeof issue.count === 'number' && issue.count > 0
          ? ` x${issue.count}`
          : '';
      return `${label}${editions}${count}`;
    })
    .join(' · ');
}

@Injectable()
export class SystemHealthAlertService {
  private readonly logger = new Logger(SystemHealthAlertService.name);
  private lastCriticalFingerprint: string | null = null;

  constructor(
    private readonly health: SystemHealthService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'atlas-system-health-critical-alerts',
    timeZone: 'Asia/Kuala_Lumpur',
    waitForCompletion: true,
  })
  async checkCriticalIssues() {
    try {
      const snapshot = await this.health.getSystemHealth();
      const issues = (snapshot.issues ?? []) as HealthIssue[];
      const fingerprint = criticalIssueFingerprint(issues);

      if (!fingerprint) {
        if (this.lastCriticalFingerprint) {
          await this.notifications.notify({
            category: 'system',
            title: 'ATLAS system recovered',
            body: 'Critical System Health issues have cleared.',
            tag: 'atlas-system-health-critical',
            url: '/system-health',
          });
          this.logger.log('System Health critical alert recovered.');
        }

        this.lastCriticalFingerprint = null;
        return {
          alerted: false,
          recovered: true,
          criticalCount: 0,
        };
      }

      if (fingerprint === this.lastCriticalFingerprint) {
        return {
          alerted: false,
          recovered: false,
          criticalCount: issues.filter((issue) => issue.severity === 'critical').length,
          deduplicated: true,
        };
      }

      const summary = criticalIssueSummary(issues);

      await this.notifications.notify({
        category: 'system',
        title: 'ATLAS critical system alert',
        body: summary || 'A critical System Health issue requires attention.',
        tag: 'atlas-system-health-critical',
        url: '/system-health',
      });

      this.lastCriticalFingerprint = fingerprint;
      this.logger.warn(`System Health critical alert sent: ${summary || fingerprint}`);

      return {
        alerted: true,
        recovered: false,
        criticalCount: issues.filter((issue) => issue.severity === 'critical').length,
        fingerprint,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown System Health alert error';

      this.logger.error(`System Health alert check failed: ${message}`);

      return {
        alerted: false,
        recovered: false,
        error: message,
      };
    }
  }
}
