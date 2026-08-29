import { Module } from '@nestjs/common';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorService } from './agent-supervisor.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { PrismaFileOwnershipStore } from './persistence/prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './persistence/prisma-supervisor-execution.store';
import { PrismaSupervisorTaskStore } from './persistence/prisma-supervisor-task.store';
import { FILE_OWNERSHIP_STORE } from './stores/file-ownership.store';
import { SUPERVISOR_EXECUTION_STORE } from './stores/supervisor-execution.store';
import { SUPERVISOR_TASK_STORE } from './stores/supervisor-task.store';

@Module({
  controllers: [AgentSupervisorController],
  providers: [
    AgentSupervisorService,
    WorkerDispatcherService,
    PrismaSupervisorTaskStore,
    PrismaSupervisorExecutionStore,
    PrismaFileOwnershipStore,
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
  ],
  exports: [
    AgentSupervisorService,
    WorkerDispatcherService,
    SUPERVISOR_TASK_STORE,
    SUPERVISOR_EXECUTION_STORE,
    FILE_OWNERSHIP_STORE,
  ],
})
export class AgentSupervisorModule {}
