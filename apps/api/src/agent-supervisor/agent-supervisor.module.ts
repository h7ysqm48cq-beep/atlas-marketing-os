import { Module } from '@nestjs/common';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorService } from './agent-supervisor.service';
import {
  FILE_OWNERSHIP_STORE,
} from './stores/file-ownership.store';
import { MemoryFileOwnershipStore } from './stores/memory-file-ownership.store';
import { MemorySupervisorTaskStore } from './stores/memory-supervisor-task.store';
import {
  SUPERVISOR_TASK_STORE,
} from './stores/supervisor-task.store';

@Module({
  controllers: [AgentSupervisorController],
  providers: [
    AgentSupervisorService,
    MemorySupervisorTaskStore,
    MemoryFileOwnershipStore,
    {
      provide: SUPERVISOR_TASK_STORE,
      useExisting: MemorySupervisorTaskStore,
    },
    {
      provide: FILE_OWNERSHIP_STORE,
      useExisting: MemoryFileOwnershipStore,
    },
  ],
  exports: [
    AgentSupervisorService,
    SUPERVISOR_TASK_STORE,
    FILE_OWNERSHIP_STORE,
  ],
})
export class AgentSupervisorModule {}
