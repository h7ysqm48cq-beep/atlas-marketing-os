import { NotificationService } from './notification.service';

describe('NotificationService schema bootstrap', () => {
  it('upgrades an existing push subscription table with the enabled column', async () => {
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationService(
      { $executeRawUnsafe: executeRawUnsafe } as never,
      { get: jest.fn() } as never,
    );

    await service.onModuleInit();

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "enabled"'),
    );
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "id"'),
    );
  });

  it('supplies an id when storing a subscription', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const service = new NotificationService(
      {
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        $executeRaw: executeRaw,
      } as never,
      { get: jest.fn() } as never,
    );

    await service.subscribe({
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'p256dh', auth: 'auth' },
    });

    const [query, id] = executeRaw.mock.calls[0];
    expect(query.join(' ')).toContain(
      'INSERT INTO "PushSubscription" ("id", "endpoint"',
    );
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
