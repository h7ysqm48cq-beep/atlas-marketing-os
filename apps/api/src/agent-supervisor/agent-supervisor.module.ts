import { Module } from '@nestjs/common';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorService } from './agent-supervisor.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { ProductionDeploymentGateService } from './deployment/production-deployment-gate.service';
import { AgentGatewayService } from './gateway/agent-gateway.service';
import { SupervisorCiGuard } from './gateway/supervisor-ci.guard';
import { SupervisorGatewayController } from './gateway/supervisor-gateway.controller';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';
import { PrismaFileOwnershipStore } from './persistence/prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './persistence/prisma-supervisor-execution.store';
import { PrismaSupervisorLifecycleStore } from './persistence/prisma-supervisor-lifecycle.store';
import { PrismaSupervisorTaskStore } from './persistence/prisma-supervisor-task.store';
import { FILE_OWNERSHIP_STORE } from './stores/file-ownership.store';
import { SUPERVISOR_EXECUTION_STORE } from './stores/supervisor-execution.store';
import { SUPERVISOR_LIFECYCLE_STORE } from './stores/supervisor-lifecycle.store';
import { SUPERVISOR_TASK_STORE } from './stores/supervisor-task.store';

@Module({
  controllers: [AgentSupervisorController, SupervisorGatewayController],
  providers: [
    AgentSupervisorService,
    WorkerDispatcherService,
    ProductionDeploymentGateService,
    AgentGatewayService,
    SupervisorCiGuard,
    SupervisorOwnerGuard,
    PrismaSupervisorTaskStore,
    PrismaSupervisorExecutionStore,
    PrismaFileOwnershipStore,
    PrismaSupervisorLifecycleStore,
    {
      provide: SUPERVISOR_TASK_STORE,
      useExisting: PrismaSupervisorTaskStore,
    },
    {
      provide: SUPERVISOR_EXECUTION_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    },
    {
      provide: FILE_OWNERSHIP_STORE,
      useExisting: PrismaFileOwnershipStore,
    },
    {
      provide: SUPERVISOR_LIFECYCLE_STORE,
      useExisting: PrismaSupervisorLifecycleStore,
    },
  ],
  exports: [
    AgentSupervisorService,
    WorkerDispatcherService,
    AgentGatewayService,
    SUPERVISOR_TASK_STORE,
    SUPERVISOR_EXECUTION_STORE,
    FILE_OWNERSHIP_STORE,
    SUPERVISOR_LIFECYCLE_STORE,
  ],
})
export class AgentSupervisorModule {}
