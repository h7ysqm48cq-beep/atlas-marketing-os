import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AgentSupervisorService } from './agent-supervisor.service';
import {
  HumanOwnerApprovalService,
} from './authority/human-owner-approval.service';
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

type HumanOwnerRequest = {
  user?: {
    id?: string;
  };
  headers?: Record<
    string,
    string | string[] | undefined
  >;
};

@UseGuards(SupervisorOwnerActionGuard, SupervisorOwnerGuard)
@Controller('engineering/supervisor')
export class AgentSupervisorController {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    private readonly dispatcher: WorkerDispatcherService,
    @Optional()
    private readonly humanOwnerApproval?: HumanOwnerApprovalService,
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

  @Post('tasks/:id/abort')
  abortTask(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.supervisor.abortTask(id, body.reason ?? '');
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
    @Req() request: HumanOwnerRequest,
  ) {
    const signer =
      this.requireHumanOwnerApproval();

    const proof =
      signer.verifyAuthentication(
        this.ownerAuthenticationEvidence(
          request,
        ),
        {
          action: 'MERGE',
          candidate: body.candidate,
        },
      );

    const authorization =
      signer.issueMergeApproval(
        proof,
        body.candidate,
      );

    return this.supervisor.authorizeMerge(
      id,
      body.candidate,
      authorization,
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
    @Req() request: HumanOwnerRequest,
  ) {
    const signer =
      this.requireHumanOwnerApproval();

    const proof =
      signer.verifyAuthentication(
        this.ownerAuthenticationEvidence(
          request,
        ),
        {
          action: 'DEPLOY',
          candidate: body.candidate,
          service: body.service,
        },
      );

    const authorization =
      signer.issueDeployApproval(
        proof,
        body.candidate,
        body.service,
      );

    return this.supervisor
      .authorizeProductionDeployment(
        id,
        body.candidate,
        body.service,
        authorization,
      );
  }

  private requireHumanOwnerApproval(): HumanOwnerApprovalService {
    if (!this.humanOwnerApproval) {
      throw new ServiceUnavailableException(
        'human_owner_approval_signer_not_configured',
      );
    }

    return this.humanOwnerApproval;
  }

  private ownerAuthenticationEvidence(
    request: HumanOwnerRequest,
  ) {
    return {
      userId:
        request.user?.id ?? '',
      ownerAction:
        this.requestHeader(
          request,
          'x-atlas-supervisor-owner-action',
        ),
      ownerToken:
        this.requestHeader(
          request,
          'x-atlas-supervisor-owner-token',
        ),
    };
  }

  private requestHeader(
    request: HumanOwnerRequest,
    name: string,
  ): string {
    const value =
      request.headers?.[name];

    if (Array.isArray(value)) {
      return value[0] ?? '';
    }

    return value ?? '';
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
    return this.dispatcher.dispatch(id, 'IMPLEMENTATION');
  }

  @Post('tasks/:id/dispatch-verification')
  dispatchVerificationTask(@Param('id') id: string) {
    return this.dispatcher.dispatch(
      id,
      'INDEPENDENT_VERIFICATION',
    );
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
