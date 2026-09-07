import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
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
import { SupervisorRunnerGuard } from '../runner/supervisor-runner.guard';

@Public()
@Controller('engineering/supervisor/gateway')
export class SupervisorGatewayController {
  constructor(
    private readonly gateway: AgentGatewayService,
    private readonly runnerClaims: SupervisorRunnerClaimService,
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

  @Post('runner/claim-next')
  @UseGuards(SupervisorRunnerGuard)
  claimNext(@Headers('x-atlas-runner-id') runnerId: string) {
    return this.runnerClaims.claimNext(runnerId);
  }

  @Post('runner/executions/:executionId/heartbeat')
  @UseGuards(SupervisorRunnerGuard)
  heartbeat(
    @Headers('x-atlas-runner-id') runnerId: string,
    @Param('executionId') executionId: string,
    @Body() body: { claimEpoch: number },
  ) {
    return this.runnerClaims.heartbeat(
      executionId,
      runnerId,
      body.claimEpoch,
    );
  }
}
