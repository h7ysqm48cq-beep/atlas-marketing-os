import {
  getEditionPlatforms,
  resolveSportsNewsInitialStatus,
  shouldRunScheduledEdition,
} from './sports-news-automation.service';
import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';

describe('shouldRunScheduledEdition', () => {
  const now = new Date('2026-08-17T02:30:00.000Z');

  it('allows a missed morning edition inside the catch-up window', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '10:30',
        scheduledTime: '08:00',
        beforeTime: '18:00',
        lastCompletedAt: null,
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(true);
  });

  it('does not rerun an edition already completed today', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '10:30',
        scheduledTime: '08:00',
        beforeTime: '18:00',
        lastCompletedAt: new Date('2026-08-17T01:00:00.000Z'),
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(false);
  });

  it('keeps the morning edition outside the evening window', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '18:00',
        scheduledTime: '08:00',
        beforeTime: '18:00',
        lastCompletedAt: null,
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(false);
  });

  it('allows a new edition after the local date changes', () => {
    expect(
      shouldRunScheduledEdition({
        enabled: true,
        currentTime: '08:05',
        scheduledTime: '08:00',
        lastCompletedAt: new Date('2026-08-16T01:00:00.000Z'),
        now,
        timezone: 'Asia/Kuala_Lumpur',
      }),
    ).toBe(true);
  });

  it('builds the target list from global and edition channel switches', () => {
    expect(
      getEditionPlatforms('MORNING', {
        telegramEnabled: true,
        facebookEnabled: true,
        morningTelegramEnabled: false,
        morningFacebookEnabled: true,
        eveningTelegramEnabled: true,
        eveningFacebookEnabled: false,
      }),
    ).toEqual([SocialPlatform.FACEBOOK]);
  });

  it('keeps approval-required content in draft', () => {
    expect(
      resolveSportsNewsInitialStatus({
        autoPublishEnabled: true,
        approvalRequired: true,
        queueStatusOnCreate: 'QUEUED',
      }),
    ).toBe(ScheduledPostStatus.DRAFT);
  });

  it('keeps content in draft when auto publishing is disabled', () => {
    expect(
      resolveSportsNewsInitialStatus({
        autoPublishEnabled: false,
        approvalRequired: false,
        queueStatusOnCreate: 'SCHEDULED',
      }),
    ).toBe(ScheduledPostStatus.DRAFT);
  });

  it('honors the configured queue status when automatic publishing is safe', () => {
    expect(
      resolveSportsNewsInitialStatus({
        autoPublishEnabled: true,
        approvalRequired: false,
        queueStatusOnCreate: 'SCHEDULED',
      }),
    ).toBe(ScheduledPostStatus.SCHEDULED);
  });
});
