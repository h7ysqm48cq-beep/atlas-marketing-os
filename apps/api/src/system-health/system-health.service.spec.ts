jest.mock('../automation/browser-runtime-bridge.service', () => ({
  BrowserRuntimeBridgeService: class {},
}));
jest.mock('../assets/assets.service', () => ({ AssetsService: class {} }));

import {
  buildDeploymentAutomationHealth,
  buildSportsSchedulerHealth,
  buildSupervisorGovernanceHealth,
  buildSystemHealthIssues,
  SystemHealthService,
} from './system-health.service';

function freshDeploymentHeartbeat() {
  return {
    service: 'production-deploy-executor' as const,
    phase: 'cycle_complete' as const,
    cycle: 1,
    commitSha: 'fb5e55481844c4670d451d5a429640e07f5482b5',
    claimedWork: false,
    nextPollMs: 120_000,
    receivedAt: new Date().toISOString(),
  };
}

describe('SystemHealthService', () => {
  it('reports calendar health from the scheduled-post table', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(2),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            publishedAt: new Date('2026-09-27T20:00:00.000Z'),
          })
          .mockResolvedValueOnce({
            scheduledAt: new Date('2026-09-28T01:00:00.000Z'),
          }),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'QUEUED', _count: { _all: 2 } },
          { status: 'RUNNING', _count: { _all: 1 } },
          { status: 'SUCCEEDED', _count: { _all: 4 } },
          { status: 'FAILED', _count: { _all: 3 } },
        ]),
      },
    };
    const service = new SystemHealthService(
      prisma as never,
      {
        health: jest.fn().mockResolvedValue({
          status: 'healthy',
          provider: 'supabase',
          bucket: 'atlas-assets',
          configured: true,
          message: null,
        }),
      } as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
      {
        snapshot: jest.fn().mockReturnValue(freshDeploymentHeartbeat()),
        getObservationStartedAt: jest
          .fn()
          .mockReturnValue(new Date().toISOString()),
      } as never,
      {
        list: jest.fn().mockResolvedValue([]),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.calendar).toEqual({ status: 'healthy', scheduledPosts: 3 });
    expect(health.supervisorGovernance).toEqual({
      status: 'healthy',
      totalTasks: 0,
      activeTasks: 0,
      staleActiveTasks: 0,
      activeMergeAuthorizations: 0,
      activeDeploymentAuthorizations: 0,
      activeDeploymentReservations: 0,
      oldestStaleTaskAgeSeconds: null,
      staleAfterHours: 24,
    });
    expect(health.deploymentAutomation).toEqual(
      expect.objectContaining({
        status: 'healthy',
        policy: 'railway_daemon_primary_github_schedule_fallback',
        primary: expect.objectContaining({
          provider: 'railway',
          mode: 'daemon',
          service: 'production-deploy-executor',
          expectedCadenceSeconds: 60,
          livenessSource: 'runtime_heartbeat',
          staleAfterSeconds: 300,
          phase: 'cycle_complete',
          cycle: 1,
          commitSha: 'fb5e55481844c4670d451d5a429640e07f5482b5',
        }),
        fallback: {
          provider: 'github-actions',
          mode: 'schedule',
          workflow: 'atlas-production-deploy-executor.yml',
          configuredCron: '*/5 * * * *',
          cadenceGuarantee: 'best_effort',
        },
      }),
    );
    expect(health.publishing).toEqual({
      status: 'healthy',
      overdueEligiblePosts: 0,
      stuckPublishingPosts: 0,
      recentFailedPosts: 0,
      publishedLast24h: 2,
      latestPublishedAt: '2026-09-27T20:00:00.000Z',
      nextScheduledAt: '2026-09-28T01:00:00.000Z',
      thresholds: {
        stuckMinutes: 15,
        failureWindowHours: 24,
      },
    });
    expect(health.issues).toEqual([]);
    expect(health.queues).toEqual({
      status: 'healthy',
      backgroundJobs: {
        queued: 2,
        running: 1,
        succeeded: 4,
        failed: 3,
        cancelled: 0,
        total: 10,
      },
    });
  });

  it('marks asset storage critical when the read-only storage probe fails', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      sportsNewsSetting: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new SystemHealthService(
      prisma as never,
      {
        health: jest.fn().mockResolvedValue({
          status: 'critical',
          provider: 'supabase',
          bucket: 'atlas-assets',
          configured: true,
          message: 'storage unavailable',
        }),
      } as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
      {
        snapshot: jest.fn().mockReturnValue(freshDeploymentHeartbeat()),
        getObservationStartedAt: jest
          .fn()
          .mockReturnValue(new Date().toISOString()),
      } as never,
      {
        list: jest.fn().mockResolvedValue([]),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.assets).toEqual({
      status: 'critical',
      provider: 'supabase',
      bucket: 'atlas-assets',
      configured: true,
      message: 'storage unavailable',
    });

    expect(health.issues).toContainEqual({
      code: 'assets_unhealthy',
      severity: 'critical',
    });
  });

  it('marks publishing health critical for overdue or stuck posts', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(4),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            publishedAt: new Date('2026-09-27T19:00:00.000Z'),
          })
          .mockResolvedValueOnce({
            scheduledAt: new Date('2026-09-28T01:00:00.000Z'),
          }),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SystemHealthService(
      prisma as never,
      {
        health: jest.fn().mockResolvedValue({
          status: 'healthy',
          provider: 'supabase',
          bucket: 'atlas-assets',
          configured: true,
          message: null,
        }),
      } as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
      {
        snapshot: jest.fn().mockReturnValue(freshDeploymentHeartbeat()),
        getObservationStartedAt: jest
          .fn()
          .mockReturnValue(new Date().toISOString()),
      } as never,
      {
        list: jest.fn().mockResolvedValue([]),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.publishing.status).toBe('critical');
    expect(health.publishing.overdueEligiblePosts).toBe(2);
    expect(health.publishing.stuckPublishingPosts).toBe(1);
    expect(health.issues).toEqual([
      {
        code: 'publishing_overdue',
        severity: 'critical',
        count: 2,
      },
      {
        code: 'publishing_stuck',
        severity: 'critical',
        count: 1,
      },
    ]);
  });

  it('marks publishing health degraded for recent failures without stuck work', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      scheduledPost: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(1),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            publishedAt: new Date('2026-09-27T18:00:00.000Z'),
          })
          .mockResolvedValueOnce(null),
      },
      backgroundJob: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SystemHealthService(
      prisma as never,
      {
        health: jest.fn().mockResolvedValue({
          status: 'healthy',
          provider: 'supabase',
          bucket: 'atlas-assets',
          configured: true,
          message: null,
        }),
      } as never,
      {
        health: jest.fn().mockResolvedValue({
          healthy: true,
          service: 'test-browser-worker',
        }),
      } as never,
      {
        snapshot: jest.fn().mockReturnValue(freshDeploymentHeartbeat()),
        getObservationStartedAt: jest
          .fn()
          .mockReturnValue(new Date().toISOString()),
      } as never,
      {
        list: jest.fn().mockResolvedValue([]),
      } as never,
    );

    const health = await service.getSystemHealth();

    expect(health.publishing.status).toBe('degraded');
    expect(health.publishing.recentFailedPosts).toBe(3);
    expect(health.publishing.publishedLast24h).toBe(1);
    expect(health.publishing.latestPublishedAt).toBe(
      '2026-09-27T18:00:00.000Z',
    );
    expect(health.publishing.nextScheduledAt).toBeNull();
    expect(health.issues).toEqual([
      {
        code: 'publishing_recent_failures',
        severity: 'warning',
        count: 3,
      },
    ]);
  });
});


describe('buildSupervisorGovernanceHealth', () => {
  const now = new Date('2026-10-08T00:00:00.000Z');

  const task = (
    status: string,
    updatedAt: string,
    evidence: Record<string, unknown> | null = null,
  ) => ({
    id: 'ATLAS-TEST',
    objective: 'test',
    owner: 'engineering',
    status,
    allowedPaths: [],
    forbiddenActions: [],
    dependsOn: [],
    acceptance: [],
    evidence,
    blockingReason: null,
    failureReason: null,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
  }) as never;

  it('reports healthy when active tasks are fresh and no authority residue exists', () => {
    expect(
      buildSupervisorGovernanceHealth([
        task('DRAFT', '2026-10-07T23:00:00.000Z'),
        task('APPROVED', '2026-10-06T00:00:00.000Z', {
          deploymentState: 'DEPLOYMENT_AUTHORIZATION_CONSUMED',
          ownerDeploymentDispatchReservation: {},
          ownerDeploymentAuthorizationConsumption: {},
        }),
      ], now),
    ).toEqual({
      status: 'healthy',
      totalTasks: 2,
      activeTasks: 1,
      staleActiveTasks: 0,
      activeMergeAuthorizations: 0,
      activeDeploymentAuthorizations: 0,
      activeDeploymentReservations: 0,
      oldestStaleTaskAgeSeconds: null,
      staleAfterHours: 24,
    });
  });

  it('degrades for stale active tasks without treating them as authority residue', () => {
    const health = buildSupervisorGovernanceHealth([
      task('BLOCKED', '2026-10-06T23:00:00.000Z'),
    ], now);

    expect(health.status).toBe('degraded');
    expect(health.staleActiveTasks).toBe(1);
    expect(health.oldestStaleTaskAgeSeconds).toBe(90_000);
  });

  it('fails closed for active unconsumed merge, deploy, or reservation authority', () => {
    const health = buildSupervisorGovernanceHealth([
      task('APPROVED', '2026-10-07T23:00:00.000Z', {
        ownerMergeAuthorization: {},
      }),
      task('APPROVED', '2026-10-07T23:00:00.000Z', {
        ownerDeploymentAuthorization: {},
      }),
      task('APPROVED', '2026-10-07T23:00:00.000Z', {
        deploymentState: 'NOT_DEPLOYED',
        ownerDeploymentDispatchReservation: {},
      }),
    ], now);

    expect(health.status).toBe('critical');
    expect(health.activeMergeAuthorizations).toBe(1);
    expect(health.activeDeploymentAuthorizations).toBe(1);
    expect(health.activeDeploymentReservations).toBe(1);
  });

  it('ignores retired deployment reservations and fails closed when persistence is unavailable', () => {
    expect(
      buildSupervisorGovernanceHealth([
        task('APPROVED', '2026-10-07T23:00:00.000Z', {
          deploymentState: 'DEPLOYMENT_AUTHORIZATION_RETIRED',
          ownerDeploymentDispatchReservation: {},
        }),
      ], now).activeDeploymentReservations,
    ).toBe(0);

    expect(buildSupervisorGovernanceHealth(null, now)).toEqual({
      status: 'unknown',
      totalTasks: null,
      activeTasks: null,
      staleActiveTasks: null,
      activeMergeAuthorizations: null,
      activeDeploymentAuthorizations: null,
      activeDeploymentReservations: null,
      oldestStaleTaskAgeSeconds: null,
      staleAfterHours: 24,
    });
  });
});


describe('buildSportsSchedulerHealth', () => {
  const settings = {
    enabled: true,
    timezone: 'Asia/Kuala_Lumpur',
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '20:00',
    lastMorningRunAt: new Date('2026-09-28T01:02:00.000Z'),
    lastEveningRunAt: new Date('2026-09-27T12:02:00.000Z'),
    lastRunStatus: 'SUCCESS',
    lastError: null,
  };

  it('reports healthy and the next local run before the morning slot', () => {
    const health = buildSportsSchedulerHealth(
      {
        ...settings,
        lastMorningRunAt: new Date('2026-09-27T01:02:00.000Z'),
      },
      new Date('2026-09-27T21:53:00.000Z'),
    );

    expect(health.status).toBe('healthy');
    expect(health.missedRuns).toEqual([]);
    expect(health.nextRunLocal).toBe(
      '2026-09-28 09:00 Asia/Kuala_Lumpur MORNING',
    );
  });

  it('fails closed when an enabled morning run is still missing after grace', () => {
    const health = buildSportsSchedulerHealth(
      {
        ...settings,
        lastMorningRunAt: new Date('2026-09-27T01:02:00.000Z'),
      },
      new Date('2026-09-28T01:20:00.000Z'),
    );

    expect(health.status).toBe('critical');
    expect(health.missedRuns).toEqual(['MORNING']);
    expect(health.nextRunLocal).toBe(
      '2026-09-28 20:00 Asia/Kuala_Lumpur EVENING',
    );
  });

  it('does not treat disabled sports automation as a failure', () => {
    const health = buildSportsSchedulerHealth(
      {
        ...settings,
        enabled: false,
      },
      new Date('2026-09-28T04:00:00.000Z'),
    );

    expect(health.status).toBe('disabled');
    expect(health.missedRuns).toEqual([]);
    expect(health.nextRunLocal).toBeNull();
  });
});


describe('buildDeploymentAutomationHealth', () => {
  const now = new Date('2026-10-07T16:00:00.000Z');
  const heartbeat = {
    service: 'production-deploy-executor' as const,
    phase: 'cycle_complete' as const,
    cycle: 7,
    commitSha: 'fb5e55481844c4670d451d5a429640e07f5482b5',
    claimedWork: false,
    nextPollMs: 120_000,
    receivedAt: '2026-10-07T15:59:00.000Z',
  };

  it('uses a startup grace before failing closed on a missing daemon heartbeat', () => {
    const warming = buildDeploymentAutomationHealth(
      null,
      now,
      '2026-10-07T15:58:00.000Z',
    );
    const stale = buildDeploymentAutomationHealth(
      null,
      now,
      '2026-10-07T15:55:00.000Z',
    );

    expect(warming.status).toBe('degraded');
    expect(warming.primary.lastHeartbeatAt).toBeNull();
    expect(warming.primary.observationAgeSeconds).toBe(120);
    expect(stale.status).toBe('critical');
    expect(stale.primary.observationAgeSeconds).toBe(300);
  });

  it('reports a recent daemon heartbeat as healthy', () => {
    const health = buildDeploymentAutomationHealth(heartbeat, now);

    expect(health.status).toBe('healthy');
    expect(health.primary.ageSeconds).toBe(60);
    expect(health.primary.staleAfterSeconds).toBe(300);
  });

  it('degrades after three minutes and becomes critical after five', () => {
    expect(
      buildDeploymentAutomationHealth(
        { ...heartbeat, receivedAt: '2026-10-07T15:56:30.000Z' },
        now,
      ).status,
    ).toBe('degraded');

    expect(
      buildDeploymentAutomationHealth(
        { ...heartbeat, receivedAt: '2026-10-07T15:55:00.000Z' },
        now,
      ).status,
    ).toBe('critical');
  });

  it('reports a failed daemon cycle as critical immediately', () => {
    expect(
      buildDeploymentAutomationHealth(
        { ...heartbeat, phase: 'cycle_failed' },
        now,
      ).status,
    ).toBe('critical');
  });
});


describe('buildSystemHealthIssues', () => {
  const healthy = {
    deploymentAutomation: {
      status: 'healthy',
      primary: { ageSeconds: 0, phase: 'cycle_complete' },
    },
    supervisorGovernance: {
      status: 'healthy',
      staleActiveTasks: 0,
      activeMergeAuthorizations: 0,
      activeDeploymentAuthorizations: 0,
      activeDeploymentReservations: 0,
    },
    database: { status: 'healthy' },
    browserWorker: { healthy: true },
    assets: { status: 'healthy' },
    calendar: { status: 'healthy' },
    publishing: {
      status: 'healthy',
      overdueEligiblePosts: 0,
      stuckPublishingPosts: 0,
      recentFailedPosts: 0,
    },
    sportsScheduler: {
      status: 'healthy',
      missedRuns: [],
      lastError: null,
    },
    queues: {
      status: 'healthy',
      backgroundJobs: {
        failed: 4,
      },
    },
  };

  it('returns no issues for healthy core subsystems', () => {
    expect(buildSystemHealthIssues(healthy)).toEqual([]);
  });

  it('surfaces supervisor governance authority residue as critical and stale tasks as warning', () => {
    expect(
      buildSystemHealthIssues({
        ...healthy,
        supervisorGovernance: {
          status: 'critical',
          staleActiveTasks: 0,
          activeMergeAuthorizations: 1,
          activeDeploymentAuthorizations: 2,
          activeDeploymentReservations: 1,
        },
      }),
    ).toContainEqual({
      code: 'supervisor_governance_authority_residue',
      severity: 'critical',
      activeMergeAuthorizations: 1,
      activeDeploymentAuthorizations: 2,
      activeDeploymentReservations: 1,
    });

    expect(
      buildSystemHealthIssues({
        ...healthy,
        supervisorGovernance: {
          status: 'degraded',
          staleActiveTasks: 3,
          activeMergeAuthorizations: 0,
          activeDeploymentAuthorizations: 0,
          activeDeploymentReservations: 0,
        },
      }),
    ).toContainEqual({
      code: 'supervisor_governance_stale_tasks',
      severity: 'warning',
      count: 3,
    });

    expect(
      buildSystemHealthIssues({
        ...healthy,
        supervisorGovernance: {
          status: 'unknown',
          staleActiveTasks: null,
          activeMergeAuthorizations: null,
          activeDeploymentAuthorizations: null,
          activeDeploymentReservations: null,
        },
      }),
    ).toContainEqual({
      code: 'supervisor_governance_health_unknown',
      severity: 'critical',
    });
  });

  it('promotes database, browser, calendar, and queue availability failures to critical issues', () => {
    expect(
      buildSystemHealthIssues({
        ...healthy,
        database: {
          status: 'critical',
          message: 'db unavailable',
        },
        browserWorker: {
          status: 'unknown',
          message: 'browser worker unavailable',
        },
        calendar: {
          status: 'critical',
        },
        queues: {
          status: 'unknown',
          backgroundJobs: null,
        },
      }),
    ).toEqual([
      {
        code: 'database_unhealthy',
        severity: 'critical',
        message: 'db unavailable',
      },
      {
        code: 'browser_worker_unhealthy',
        severity: 'critical',
        message: 'browser worker unavailable',
      },
      {
        code: 'calendar_unhealthy',
        severity: 'critical',
      },
      {
        code: 'background_queue_health_unknown',
        severity: 'critical',
      },
    ]);
  });

  it('promotes unknown sports scheduler health to a critical issue', () => {
    const healthy = {
      deploymentAutomation: {
        status: 'healthy',
        primary: { ageSeconds: 0, phase: 'cycle_complete' },
      },
      supervisorGovernance: {
        status: 'healthy',
        staleActiveTasks: 0,
        activeMergeAuthorizations: 0,
        activeDeploymentAuthorizations: 0,
        activeDeploymentReservations: 0,
      },
      database: { status: 'healthy' },
      browserWorker: { healthy: true },
      assets: { status: 'healthy' },
      calendar: { status: 'healthy' },
      publishing: {
        status: 'healthy',
        overdueEligiblePosts: 0,
        stuckPublishingPosts: 0,
        recentFailedPosts: 0,
      },
      sportsScheduler: {
        status: 'unknown',
        missedRuns: [],
        lastError: null,
      },
      queues: {
        status: 'healthy',
        backgroundJobs: {
          failed: 0,
        },
      },
    };

    expect(buildSystemHealthIssues(healthy)).toContainEqual({
      code: 'sports_scheduler_health_unknown',
      severity: 'critical',
    });
  });

  it('preserves publishing and sports scheduler issue semantics', () => {
    expect(
      buildSystemHealthIssues({
        ...healthy,
        publishing: {
          status: 'critical',
          overdueEligiblePosts: 2,
          stuckPublishingPosts: 1,
          recentFailedPosts: 3,
        },
        sportsScheduler: {
          status: 'degraded',
          missedRuns: ['MORNING'],
          lastError: 'generation failed',
        },
      }),
    ).toEqual([
      {
        code: 'publishing_overdue',
        severity: 'critical',
        count: 2,
      },
      {
        code: 'publishing_stuck',
        severity: 'critical',
        count: 1,
      },
      {
        code: 'publishing_recent_failures',
        severity: 'warning',
        count: 3,
      },
      {
        code: 'sports_scheduler_missed_run',
        severity: 'critical',
        count: 1,
        editions: ['MORNING'],
      },
      {
        code: 'sports_scheduler_last_run_failed',
        severity: 'warning',
        message: 'generation failed',
      },
    ]);
  });
});
