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
  });
});
