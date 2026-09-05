import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentSupervisorService } from './agent-supervisor.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import type { WorkerExecutionResult } from './execution/supervisor-execution.types';
import { SupervisorOwnerActionGuard } from './gateway/supervisor-owner-action.guard';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';
import type {
  CreateSupervisorTaskInput,
  PermissionContext,
  ProductionDeploymentService,
  SupervisorAction,
  SupervisorAgentRole,
  SupervisorEvidence,
  SupervisorMergeAttestation,
  SupervisorReviewCandidate,
} from './agent-supervisor.types';

@UseGuards(SupervisorOwnerActionGuard, SupervisorOwnerGuard)
@Controller('engineering/supervisor')
export class AgentSupervisorController {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    private readonly dispatcher: WorkerDispatcherService,
  ) {}

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
  returnToWorking(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.supervisor.returnToWorking(id, body.reason ?? '');
  }

  @Post('tasks/:id/ready-for-review')
  markReadyForReview(@Param('id') id: string) {
    return this.supervisor.markReadyForReview(id);
  }

  @Post('tasks/:id/approve')
  approveTask(@Param('id') id: string) {
    return this.supervisor.approveTask(id, true);
  }

  @Post('tasks/:id/authorize-merge')
  authorizeMerge(
    @Param('id') id: string,
    @Body() body: { candidate: SupervisorReviewCandidate },
    @Req() request: { user?: { id?: string } },
  ) {
    return this.supervisor.authorizeMerge(
      id,
      body.candidate,
      request.user?.id ?? '',
    );
  }

  @Post('tasks/:id/consume-merge-authorization')
  consumeMergeAuthorization(
    @Param('id') id: string,
    @Body()
    body: {
      attestation: SupervisorMergeAttestation;
    },
    @Req() request: { user?: { id?: string } },
  ) {
    return this.supervisor.consumeMergeAuthorization(
      id,
      body.attestation,
      request.user?.id ?? '',
    );
  }

  @Post('tasks/:id/authorize-production-deployment')
  authorizeProductionDeployment(
    @Param('id') id: string,
    @Body()
    body: {
      candidate: SupervisorReviewCandidate;
      service: ProductionDeploymentService;
    },
    @Req() request: { user?: { id?: string } },
  ) {
    return this.supervisor.authorizeProductionDeployment(
      id,
      body.candidate,
      body.service,
      request.user?.id ?? '',
    );
  }

  @Post('tasks/:id/revoke-production-deployment-authorization')
  revokeProductionDeploymentAuthorization(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() request: { user?: { id?: string } },
  ) {
    return this.supervisor.revokeProductionDeploymentAuthorization(
      id,
      body.reason ?? '',
      request.user?.id ?? '',
    );
  }

  @Post('tasks/:id/dispatch')
  dispatchTask(@Param('id') id: string) {
    return this.dispatcher.dispatch(id);
  }

  @Get('tasks/:id/executions')
  listExecutions(@Param('id') id: string) {
    return this.dispatcher.listByTask(id);
  }

  @Get('executions/:id')
  getExecution(@Param('id') id: string) {
    return this.dispatcher.getExecution(id);
  }

  @Post('executions/:id/running')
  markExecutionRunning(@Param('id') id: string) {
    return this.dispatcher.markRunning(id);
  }

  @Post('executions/:id/complete')
  completeExecution(
    @Param('id') id: string,
    @Body() result: WorkerExecutionResult,
  ) {
    return this.dispatcher.complete(id, result);
  }

  @Post('executions/:id/fail')
  failExecution(@Param('id') id: string, @Body() body: { error: string }) {
    return this.dispatcher.fail(id, body.error ?? '');
  }

  @Post('executions/:id/cancel')
  cancelExecution(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.dispatcher.cancel(id, body.reason ?? '');
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
