import { ScheduledPostStatus } from '../generated/prisma/enums';

export function isQueuePostAlreadySatisfied(
  status: ScheduledPostStatus,
) {
  return status === ScheduledPostStatus.QUEUED;
}
