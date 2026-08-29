import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AgentSupervisorService } from './agent-supervisor.service';
import type {
  CreateSupervisorTaskInput,
  PermissionContext,
  SupervisorAction,
  SupervisorAgentRole,
  SupervisorEvidence,
} from './agent-supervisor.types';

@Controller('engineering/supervisor')
export class AgentSupervisorController {
  constructor(private readonly supervisor: AgentSupervisorService) {}

  @Get('status')
  status() {
    return this.supervisor.status();
  }

  @Get('tasks')
  listTasks() {
    return this.supervisor.listTasks();
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.supervisor.getTask(id);
  }

  @Post('tasks')
  createTask(@Body() input: CreateSupervisorTaskInput) {
    return this.supervisor.createTask(input);
  }

  @Post('tasks/:id/start')
  startTask(@Param('id') id: string) {
    return this.supervisor.startTask(id);
  }

  @Post('tasks/:id/block')
  blockTask(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.supervisor.blockTask(id, body.reason ?? '');
  }

  @Post('tasks/:id/fail')
  failTask(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.supervisor.failTask(id, body.reason ?? '');
  }

  @Post('tasks/:id/implementation')
  submitImplementation(
    @Param('id') id: string,
    @Body() evidence: SupervisorEvidence,
  ) {
    return this.supervisor.submitImplementation(id, evidence);
  }

  @Post('tasks/:id/verify')
  beginVerification(@Param('id') id: string) {
    return this.supervisor.beginVerification(id);
  }

  @Post('tasks/:id/return-to-working')
  returnToWorking(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.supervisor.returnToWorking(id, body.reason ?? '');
  }

  @Post('tasks/:id/ready-for-review')
  markReadyForReview(@Param('id') id: string) {
    return this.supervisor.markReadyForReview(id);
  }

  @Post('tasks/:id/approve')
  approveTask(
    @Param('id') id: string,
    @Body() body: { explicitUserApproval: boolean },
  ) {
    return this.supervisor.approveTask(id, body.explicitUserApproval === true);
  }

  @Post('permissions/check')
  checkPermission(
    @Body()
    body: {
      role: SupervisorAgentRole;
      action: SupervisorAction;
      context?: PermissionContext;
    },
  ) {
    return this.supervisor.checkPermission(
      body.role,
      body.action,
      body.context ?? {},
    );
  }
}
