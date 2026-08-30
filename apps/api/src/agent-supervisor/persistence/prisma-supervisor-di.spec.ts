import { PrismaService } from '../../database/prisma.service';
import { PrismaFileOwnershipStore } from './prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './prisma-supervisor-execution.store';
import { PrismaSupervisorLifecycleStore } from './prisma-supervisor-lifecycle.store';
import { PrismaSupervisorTaskStore } from './prisma-supervisor-task.store';

describe('Supervisor Prisma dependency injection metadata', () => {
  const stores = [
    PrismaSupervisorTaskStore,
    PrismaSupervisorExecutionStore,
    PrismaFileOwnershipStore,
    PrismaSupervisorLifecycleStore,
  ];

  it.each(stores)(
    '%p preserves PrismaService as the runtime constructor token',
    (Store) => {
      const paramTypes = Reflect.getMetadata('design:paramtypes', Store);

      expect(paramTypes).toBeDefined();
      expect(paramTypes[0]).toBe(PrismaService);
    },
  );
});
