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

@Public()
@UseGuards(SupervisorCiGuard)
@Controller('engineering/supervisor/gateway')
export class SupervisorGatewayController {
  constructor(private readonly gateway: AgentGatewayService) {}

  @Post('validate-worker')
  validateWorker(@Body() input: ValidateWorkerContextInput) {
    return this.gateway.validateWorkerContext(input);
  }

  @Post('review-candidate')
  checkReviewCandidate(@Body() input: IntegrationGateInput) {
    return this.gateway.checkReviewCandidate(input);
  }

  @Post('production-deployment')
  checkProductionDeployment(@Body() input: ProductionDeploymentGateInput) {
    return this.gateway.checkProductionDeployment(input);
  }

  @Post('production-deployment/resolve')
  resolveProductionDeployment(@Body() input: ProductionDeploymentResolveInput) {
    return this.gateway.resolveProductionDeployment(input);
  }
}
