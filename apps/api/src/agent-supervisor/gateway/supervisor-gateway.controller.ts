import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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

@Public()
@Controller('engineering/supervisor/gateway')
export class SupervisorGatewayController {
  constructor(private readonly gateway: AgentGatewayService) {}

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
}
