import { Module } from '@nestjs/common';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorService } from './agent-supervisor.service';

@Module({
  controllers: [AgentSupervisorController],
  providers: [AgentSupervisorService],
  exports: [AgentSupervisorService],
})
export class AgentSupervisorModule {}
