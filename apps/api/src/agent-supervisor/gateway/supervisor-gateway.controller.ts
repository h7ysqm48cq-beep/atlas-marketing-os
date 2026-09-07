import { Body, Controller, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import type {
  IntegrationGateInput,
  ProductionDeploymentGateInput,
  ProductionDeploymentResolveInput,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import { AgentGatewayService } from './agent-gateway.service';
import { SupervisorCiGuard } from './supervisor-ci.guard';
import { SupervisorDeployResolverGuard } from './supervisor-deploy-resolver.guard';
import { SupervisorRunnerClaimService } from '../runner/supervisor-runner-claim.service';
import {
  SupervisorRunnerBootstrapGuard,
  SupervisorRunnerSessionGuard,
} from '../runner/supervisor-runner.guard';
import type { SupervisorRunnerRequest } from '../runner/supervisor-runner.guard';
import { SupervisorRunnerSessionService } from '../runner/supervisor-runner-session.service';

@Public()
@Controller('engineering/supervisor/gateway')
export class SupervisorGatewayController {
  constructor(
    private readonly gateway: AgentGatewayService,
    private readonly runnerClaims: SupervisorRunnerClaimService,
    @Optional()
    private readonly runnerSessions?: SupervisorRunnerSessionService,
  ) {}

  @Post('validate-worker')
  @UseGuards(SupervisorCiGuard)
  validateWorker(@Body() input: ValidateWorkerContextInput) {
    return this.gateway.validateWorkerContext(input);
  }

  @Post('review-candidate')
  @UseGuards(SupervisorCiGuard)
  checkReviewCandidate(@Body() input: IntegrationGateInput) {
    return this.gateway.checkReviewCandidate(input);
  }

  @Post('production-deployment')
  @UseGuards(SupervisorCiGuard)
  checkProductionDeployment(@Body() input: ProductionDeploymentGateInput) {
    return this.gateway.checkProductionDeployment(input);
  }

  @Post('production-deployment/resolve')
  @UseGuards(SupervisorDeployResolverGuard)
  resolveProductionDeployment(@Body() input: ProductionDeploymentResolveInput) {
    return this.gateway.resolveProductionDeployment(input);
  }

  @Post('runner/session')
  @UseGuards(SupervisorRunnerBootstrapGuard)
  createRunnerSession() {
    if (!this.runnerSessions) {
      throw new Error('runner_session_service_unavailable');
    }
    return this.runnerSessions.issue();
  }

  @Post('runner/claim-next')
  @UseGuards(SupervisorRunnerSessionGuard)
  claimNext(@Req() request: SupervisorRunnerRequest) {
    return this.runnerClaims.claimNext(this.runnerId(request));
  }

  @Post('runner/executions/:executionId/heartbeat')
  @UseGuards(SupervisorRunnerSessionGuard)
  heartbeat(
    @Req() request: SupervisorRunnerRequest,
    @Param('executionId') executionId: string,
    @Body() body: { claimEpoch: number },
  ) {
    return this.runnerClaims.heartbeat(
      executionId,
      this.runnerId(request),
      body.claimEpoch,
    );
  }

  @Post('runner/executions/:executionId/release')
  @UseGuards(SupervisorRunnerSessionGuard)
  release(
    @Req() request: SupervisorRunnerRequest,
    @Param('executionId') executionId: string,
  ) {
    return this.runnerClaims.release(executionId, this.runnerId(request));
  }

  private runnerId(request: SupervisorRunnerRequest): string {
    if (!request.atlasRunnerId) {
      throw new Error('runner_session_identity_missing');
    }
    return request.atlasRunnerId;
  }
}
