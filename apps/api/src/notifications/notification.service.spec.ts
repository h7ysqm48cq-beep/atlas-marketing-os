import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  describe('onModuleInit', () => {
    it('does not mutate the database schema during application startup', async () => {
      const prisma = {
        $executeRawUnsafe: jest.fn(),
      };

      const config = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const service = new NotificationService(
        prisma as never,
        config as never,
      );

      await service.onModuleInit();

      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });
});

jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}));
import webpush from 'web-push';
import { Logger } from '@nestjs/common';

const validConfig = {
  VAPID_PUBLIC_KEY: 'public-key', VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'https://atlas.example.com',
};
function notificationService(values: Record<string, string> = validConfig, subscriptions: unknown[] = []) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(subscriptions),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const service = new NotificationService(prisma as never, {
    get: (name: string) => values[name],
  } as never);
  return { service, prisma };
}

describe('NotificationService push delivery', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the public Web URL instead of a local-only VAPID identity', () => {
    const { service } = notificationService({
      ...validConfig, VAPID_SUBJECT: 'mailto:admin@atlas.local',
      WEB_URL: 'https://atlas.example.com',
    });
    expect(service.getConfig().enabled).toBe(true);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'https://atlas.example.com', 'public-key', 'private-key',
    );
  });
});

describe('NotificationService VAPID validation', () => {
  it('keeps an explicitly configured public email identity', () => {
    jest.clearAllMocks();
    const { service } = notificationService({ ...validConfig, VAPID_SUBJECT: 'mailto:admin@example.com' });
    expect(service.getConfig().enabled).toBe(true);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:admin@example.com', 'public-key', 'private-key',
    );
  });

  it('disables push without a usable subject rather than signing invalid notifications', () => {
    jest.clearAllMocks();
    const { service } = notificationService({ ...validConfig, VAPID_SUBJECT: 'mailto:admin@atlas.local' });
    expect(service.getConfig().enabled).toBe(false);
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
  });
});

describe('NotificationService delivery failures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('bounds each send, reports the rejection reason safely, and continues to the next device', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const subscriptions = ['old', 'current'].map((id) => ({
      endpoint: `https://web.push.apple.com/private-${id}`, p256dh: 'key', auth: 'secret',
    }));
    const send = webpush.sendNotification as jest.Mock;
    send.mockReset().mockRejectedValueOnce({
      statusCode: 403,
      body: JSON.stringify({ reason: 'BadJwtToken', endpoint: subscriptions[0].endpoint }),
    }).mockResolvedValueOnce({ statusCode: 201 });
    const { service, prisma } = notificationService(validConfig, subscriptions);
    const result = await service.notify({ title: 'Post published', body: 'Verified post', tag: 'post-1' });
    expect(result).toMatchObject({ sent: 1, failed: 1, skipped: false });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2]).toMatchObject({ timeout: 10000 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('403: BadJwtToken'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-old');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
