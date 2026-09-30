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

// S4B_BOOTSTRAP_CLAIM_WIRING_RED_BEGIN
describe('S4B bootstrap claim wiring RED contract', () => {
  it('registers the bootstrap controller/guard and claim-store token without replacing the existing store token', () => {
    const { AgentSupervisorModule } = require('./agent-supervisor.module');
    const SupervisorWorkerBootstrapController = (() => {
      try {
        return require('./worker/supervisor-worker-bootstrap.controller')
          .SupervisorWorkerBootstrapController;
      } catch {
        return undefined;
      }
    })();
    const SupervisorWorkerBootstrapGuard = (() => {
      try {
        return require('./worker/supervisor-worker-bootstrap.guard')
          .SupervisorWorkerBootstrapGuard;
      } catch {
        return undefined;
      }
    })();
    const { PrismaSupervisorExecutionStore } = require(
      './persistence/prisma-supervisor-execution.store',
    );
    const {
      SUPERVISOR_EXECUTION_CLAIM_STORE,
      SUPERVISOR_EXECUTION_STORE,
    } = require('./stores/supervisor-execution.store');

    const providers = Reflect.getMetadata('providers', AgentSupervisorModule) ?? [];
    const controllers =
      Reflect.getMetadata('controllers', AgentSupervisorModule) ?? [];
    const claimProvider = providers.find(
      (provider: { provide?: unknown }) =>
        provider?.provide === SUPERVISOR_EXECUTION_CLAIM_STORE,
    );
    const executionProvider = providers.find(
      (provider: { provide?: unknown }) =>
        provider?.provide === SUPERVISOR_EXECUTION_STORE,
    );

    expect(SupervisorWorkerBootstrapController).toBeDefined();
    expect(SupervisorWorkerBootstrapGuard).toBeDefined();
    expect(SUPERVISOR_EXECUTION_CLAIM_STORE).toBeDefined();
    expect(controllers).toContain(SupervisorWorkerBootstrapController);
    expect(providers).toContain(SupervisorWorkerBootstrapGuard);
    expect(claimProvider).toMatchObject({
      provide: SUPERVISOR_EXECUTION_CLAIM_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    });
    expect(executionProvider).toMatchObject({
      provide: SUPERVISOR_EXECUTION_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    });
    expect(providers).not.toContain(MemorySupervisorExecutionStore);
  });
});
// S4B_BOOTSTRAP_CLAIM_WIRING_RED_END

// S5B_HEARTBEAT_STORE_WIRING_RED_BEGIN
describe('S5B heartbeat store wiring RED contract', () => {
  it('binds the explicit heartbeat store token to Prisma without replacing existing tokens', () => {
    const { AgentSupervisorModule } = require('./agent-supervisor.module');
    const { PrismaSupervisorExecutionStore } = require(
      './persistence/prisma-supervisor-execution.store',
    );
    const {
      SUPERVISOR_EXECUTION_HEARTBEAT_STORE,
      SUPERVISOR_EXECUTION_CLAIM_STORE,
      SUPERVISOR_EXECUTION_STORE,
    } = require('./stores/supervisor-execution.store');
    const providers = Reflect.getMetadata('providers', AgentSupervisorModule) ?? [];
    const providerForToken = (token: unknown) =>
      providers.find(
        (provider: { provide?: unknown }) => provider?.provide === token,
      );

    expect(SUPERVISOR_EXECUTION_HEARTBEAT_STORE).toBeDefined();
    expect(providerForToken(SUPERVISOR_EXECUTION_HEARTBEAT_STORE)).toMatchObject({
      provide: SUPERVISOR_EXECUTION_HEARTBEAT_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    });
    expect(providerForToken(SUPERVISOR_EXECUTION_CLAIM_STORE)).toBeDefined();
    expect(providerForToken(SUPERVISOR_EXECUTION_STORE)).toBeDefined();
  });
});
// S5B_HEARTBEAT_STORE_WIRING_RED_END
// R1_REQUIRED_ADMISSION_DI_END

// S6_RECONCILIATION_RECOVERY_WIRING_RED_BEGIN
describe('S6 reconciliation and recovery wiring RED contract', () => {
  it('registers the reconciler and narrow store tokens without memory bindings', () => {
    let reconciler: unknown;
    let reconciliationToken: unknown;
    let recoveryToken: unknown;
    try {
      reconciler = require('./reconciliation/supervisor-execution-reconciler.service')
        .SupervisorExecutionReconcilerService;
      const stores = require('./stores/supervisor-execution.store');
      reconciliationToken = stores.SUPERVISOR_EXECUTION_RECONCILIATION_STORE;
      recoveryToken = require('./stores/supervisor-lifecycle.store')
        .SUPERVISOR_EXECUTION_RECOVERY_STORE;
    } catch {
      // Missing S6 production symbols are the intended RED condition.
    }

    const registeredProviders =
      Reflect.getMetadata('providers', AgentSupervisorModule) ?? [];
    expect(reconciler).toBeDefined();
    expect(reconciliationToken).toBeDefined();
    expect(recoveryToken).toBeDefined();
    expect(registeredProviders).toContain(reconciler);

    const reconciliationProvider = registeredProviders.find(
      (provider: { provide?: unknown }) =>
        provider?.provide === reconciliationToken,
    );
    const recoveryProvider = registeredProviders.find(
      (provider: { provide?: unknown }) => provider?.provide === recoveryToken,
    );

    expect(reconciliationProvider).toMatchObject({
      provide: reconciliationToken,
      useExisting: expect.any(Function),
    });
    expect(recoveryProvider).toMatchObject({
      provide: recoveryToken,
      useExisting: expect.any(Function),
    });
    expect(registeredProviders).not.toContain(MemorySupervisorExecutionStore);
    expect(registeredProviders).not.toContain(MemorySupervisorTaskStore);
  });
});
// S6_RECONCILIATION_RECOVERY_WIRING_RED_END
