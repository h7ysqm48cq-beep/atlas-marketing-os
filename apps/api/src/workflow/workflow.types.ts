import { SocialPlatform } from '../generated/prisma/enums';

export type ScheduleContentInput = {
  brandId: string;
  campaignId?: string;
  historyId?: string;
  title?: string;

  contents: Partial<
    Record<SocialPlatform, string>
  >;

  mediaUrls?: Partial<
    Record<SocialPlatform, string[]>
  >;

  platforms: SocialPlatform[];
  scheduledAt: string;
  timezone?: string;
  queueImmediately?: boolean;
};

export type WorkflowPostResult = {
  id: string;
  platform: SocialPlatform;
  status: string;
  scheduledAt: Date;
  channel: {
    id: string;
    name: string;
  };
};

export type ScheduleContentResult = {
  success: boolean;
  workflow: 'SCHEDULE_CONTENT';
  count: number;
  posts: WorkflowPostResult[];
};

export type AutoQueueContentItem = {
  title?: string;
  historyId?: string;
  campaignId?: string;
  contents: Partial<
    Record<SocialPlatform, string>
  >;
  mediaUrls?: Partial<
    Record<SocialPlatform, string[]>
  >;
};

export type AutoQueueInput = {
  brandId: string;
  platforms: SocialPlatform[];
  items: AutoQueueContentItem[];
  startDate: string;
  postingDays: Array<
    | 'SUN'
    | 'MON'
    | 'TUE'
    | 'WED'
    | 'THU'
    | 'FRI'
    | 'SAT'
  >;
  postingTime: string;
  timezone?: string;
  queueImmediately?: boolean;
};

export type AutoQueueResult = {
  success: boolean;
  workflow: 'AUTO_QUEUE';
  itemCount: number;
  postCount: number;
  scheduledItems: Array<{
    index: number;
    scheduledAt: string;
    title?: string;
    posts: WorkflowPostResult[];
  }>;
};
