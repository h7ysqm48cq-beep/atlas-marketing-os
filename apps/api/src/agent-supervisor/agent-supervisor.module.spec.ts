import { MODULE_METADATA } from '@nestjs/common/constants';
import { AgentSupervisorModule } from './agent-supervisor.module';
import { PrismaFileOwnershipStore } from './persistence/prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './persistence/prisma-supervisor-execution.store';
import { PrismaSupervisorTaskStore } from './persistence/prisma-supervisor-task.store';
import { FILE_OWNERSHIP_STORE } from './stores/file-ownership.store';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from './stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';
import { SUPERVISOR_EXECUTION_STORE } from './stores/supervisor-execution.store';
import { SUPERVISOR_TASK_STORE } from './stores/supervisor-task.store';

describe('AgentSupervisorModule runtime persistence wiring', () => {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    AgentSupervisorModule,
  ) as Array<unknown>;

  function providerFor(token: symbol) {
    return providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        (provider as { provide: unknown }).provide === token,
    ) as { provide: symbol; useExisting?: unknown } | undefined;
  }

  it('binds supervisor task persistence to Prisma at runtime', () => {
    expect(providers).toContain(PrismaSupervisorTaskStore);
    expect(providerFor(SUPERVISOR_TASK_STORE)).toMatchObject({
      provide: SUPERVISOR_TASK_STORE,
      useExisting: PrismaSupervisorTaskStore,
    });
    expect(providers).not.toContain(MemorySupervisorTaskStore);
  });

  it('binds supervisor execution persistence to Prisma at runtime', () => {
    expect(providers).toContain(PrismaSupervisorExecutionStore);
    expect(providerFor(SUPERVISOR_EXECUTION_STORE)).toMatchObject({
      provide: SUPERVISOR_EXECUTION_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    });
    expect(providers).not.toContain(MemorySupervisorExecutionStore);
  });

  it('binds file ownership persistence to Prisma at runtime', () => {
    expect(providers).toContain(PrismaFileOwnershipStore);
    expect(providerFor(FILE_OWNERSHIP_STORE)).toMatchObject({
      provide: FILE_OWNERSHIP_STORE,
      useExisting: PrismaFileOwnershipStore,
    });
    expect(providers).not.toContain(MemoryFileOwnershipStore);
  });
});
