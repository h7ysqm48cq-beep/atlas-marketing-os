import { AutomationSchedulerService } from './automation-scheduler.service';
import type { PublisherService } from './publisher.service';

jest.mock('./publisher.service', () => ({
  PublisherService: class PublisherService {},
}));

describe('AutomationSchedulerService', () => {
  const previousEnabled =
    process.env.AUTOMATION_SCHEDULER_ENABLED;

  afterEach(() => {
    if (previousEnabled === undefined) {
      delete process.env.AUTOMATION_SCHEDULER_ENABLED;
      return;
    }

    process.env.AUTOMATION_SCHEDULER_ENABLED =
      previousEnabled;
  });

  it('does not run the publisher when the scheduler is disabled', async () => {
    process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';
    const run = jest.fn();
    const service = new AutomationSchedulerService({
      run,
    } as unknown as PublisherService);

    await service.publishDuePosts();

    expect(run).not.toHaveBeenCalled();
  });

  it('runs the publisher when the scheduler is enabled', async () => {
    process.env.AUTOMATION_SCHEDULER_ENABLED = 'true';
    const run = jest.fn().mockResolvedValue({
      found: 0,
      published: 0,
    });
    const service = new AutomationSchedulerService({
      run,
    } as unknown as PublisherService);

    await service.publishDuePosts();

    expect(run).toHaveBeenCalledTimes(1);
  });
});
