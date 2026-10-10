import { ScheduledPostStatus } from '../generated/prisma/enums';
import { isQueuePostAlreadySatisfied } from './queue-post-policy';

describe('isQueuePostAlreadySatisfied', () => {
  it('accepts a post that the publisher queued before the user clicked', () => {
    expect(isQueuePostAlreadySatisfied(ScheduledPostStatus.QUEUED)).toBe(true);
  });

  it('does not treat a schedulable post as already queued', () => {
    expect(isQueuePostAlreadySatisfied(ScheduledPostStatus.SCHEDULED)).toBe(
      false,
    );
    expect(isQueuePostAlreadySatisfied(ScheduledPostStatus.FAILED)).toBe(false);
  });
});
