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
