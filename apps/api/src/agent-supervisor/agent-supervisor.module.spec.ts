import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { AgentSupervisorModule } from './agent-supervisor.module';
import { HumanOwnerApprovalService } from './authority/human-owner-approval.service';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';
import { PrismaFileOwnershipStore } from './persistence/prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './persistence/prisma-supervisor-execution.store';
import { PrismaSupervisorTaskStore } from './persistence/prisma-supervisor-task.store';
import { FILE_OWNERSHIP_STORE } from './stores/file-ownership.store';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorExecutionStore } from './stores/memory-supervisor-execution.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';
import { SUPERVISOR_EXECUTION_STORE } from './stores/supervisor-execution.store';
import { SUPERVISOR_TASK_STORE } from './stores/supervisor-task.store';
import { SupervisorWorkerCapabilityService } from './worker/supervisor-worker-capability.service';
import { SupervisorWorkerController } from './worker/supervisor-worker.controller';
import { SupervisorWorkerGuard } from './worker/supervisor-worker.guard';

describe('AgentSupervisorModule runtime persistence wiring', () => {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    AgentSupervisorModule,
  ) as Array<unknown>;
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    AgentSupervisorModule,
  ) as Array<unknown>;

  function providerFor(token: symbol) {
    return providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === token,
    ) as { provide: symbol; useExisting?: unknown } | undefined;
  }

  it('registers the owner mutation guard at runtime', () => {
    expect(providers).toContain(SupervisorOwnerGuard);
  });

  it('registers the execution-bound worker capability plane', () => {
    expect(providers).toEqual(
      expect.arrayContaining([
        SupervisorWorkerCapabilityService,
        SupervisorWorkerGuard,
      ]),
    );
    expect(controllers).toContain(SupervisorWorkerController);
  });

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

  it('emits ConfigService runtime metadata for HumanOwnerApprovalService', () => {
    const constructorTypes =
      Reflect.getMetadata(
        'design:paramtypes',
        HumanOwnerApprovalService,
      ) ?? [];

    expect(constructorTypes[0]).toBe(ConfigService);
  });
});

// R1_REQUIRED_ADMISSION_DI_BEGIN
describe('R1 required admission manifest DI wiring', () => {
  it('registers the admission producer and requires it in WorkerDispatcherService', () => {
    const {
      AgentSupervisorModule,
    } = require('./agent-supervisor.module');

    const {
      WorkerDispatcherService,
    } = require('./dispatch/worker-dispatcher.service');

    const {
      SupervisorAdmissionManifestService,
    } = require('./authority/supervisor-admission-manifest.service');

    const providers =
      Reflect.getMetadata('providers', AgentSupervisorModule) ?? [];

    expect(providers).toContain(
      SupervisorAdmissionManifestService,
    );

    const constructorTypes =
      Reflect.getMetadata(
        'design:paramtypes',
        WorkerDispatcherService,
      ) ?? [];

    expect(constructorTypes[3]).toBe(
      SupervisorAdmissionManifestService,
    );
  });
});
// R1_REQUIRED_ADMISSION_DI_END
