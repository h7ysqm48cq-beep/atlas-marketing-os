import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';
import type { AutomationService } from '../automation/automation.service';
import type { QueuePlannerService } from './queue-planner.service';
import { WorkflowService } from './workflow.service';

jest.mock('../automation/automation.service', () => ({
  AutomationService: class AutomationService {},
}));

describe('WorkflowService scheduled post status contract', () => {
  function createService() {
    const createMultiPlatformPosts = jest.fn().mockResolvedValue({
      success: true,
      count: 1,
      posts: [
        {
          id: 'post-1',
          platform: SocialPlatform.FACEBOOK,
          status: ScheduledPostStatus.SCHEDULED,
          scheduledAt: new Date('2030-01-02T12:00:00.000Z'),
          channel: { id: 'channel-1', name: 'Facebook' },
        },
      ],
    });
    const planQueue = jest.fn().mockReturnValue([
      {
        localDate: '2030-01-02',
        localTime: '20:00',
        timezone: 'Asia/Kuala_Lumpur',
        scheduledAtUtc: new Date('2030-01-02T12:00:00.000Z'),
      },
    ]);

    return {
      createMultiPlatformPosts,
      service: new WorkflowService(
        { createMultiPlatformPosts } as unknown as AutomationService,
        { planQueue } as unknown as QueuePlannerService,
      ),
    };
  }

  it('creates scheduled posts when scheduleContent is not queued immediately', async () => {
    const { service, createMultiPlatformPosts } = createService();

    await service.scheduleContent({
      brandId: 'brand-1',
      contents: { [SocialPlatform.FACEBOOK]: 'hello' },
      platforms: [SocialPlatform.FACEBOOK],
      scheduledAt: '2030-01-02T12:00:00.000Z',
    });

    expect(createMultiPlatformPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        queueImmediately: false,
      }),
      {
        initialStatus: ScheduledPostStatus.SCHEDULED,
      },
    );
  });

  it('creates queued posts when scheduleContent is queued immediately', async () => {
    const { service, createMultiPlatformPosts } = createService();

    await service.scheduleContent({
      brandId: 'brand-1',
      contents: { [SocialPlatform.FACEBOOK]: 'hello' },
      platforms: [SocialPlatform.FACEBOOK],
      scheduledAt: '2030-01-02T12:00:00.000Z',
      queueImmediately: true,
    });

    expect(createMultiPlatformPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        queueImmediately: true,
      }),
      {
        initialStatus: ScheduledPostStatus.QUEUED,
      },
    );
  });

  it('creates scheduled posts for autoQueue by default', async () => {
    const { service, createMultiPlatformPosts } = createService();

    await service.autoQueue({
      brandId: 'brand-1',
      platforms: [SocialPlatform.FACEBOOK],
      items: [
        {
          title: 'Scheduled item',
          contents: { [SocialPlatform.FACEBOOK]: 'hello' },
        },
      ],
      startDate: '2030-01-02',
      postingDays: ['WED'],
      postingTime: '20:00',
    });

    expect(createMultiPlatformPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        queueImmediately: false,
      }),
      {
        initialStatus: ScheduledPostStatus.SCHEDULED,
      },
    );
  });
});
