import type {
  IntegrationGateInput,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import type { AgentGatewayService } from './agent-gateway.service';
import { SupervisorGatewayController } from './supervisor-gateway.controller';

describe('SupervisorGatewayController', () => {
  it('exposes validation only and delegates to the gateway service', async () => {
    const workerDecision = {
      allowed: true,
      reason: null,
      taskId: 'ATLAS-1',
      executionId: 'ATLAS-EXEC-1',
    };
    const reviewDecision = {
      allowed: true,
      reason: null,
      taskId: 'ATLAS-2',
      executionId: 'ATLAS-EXEC-2',
    };
    const gateway = {
      validateWorkerContext: jest.fn().mockResolvedValue(workerDecision),
      checkReviewCandidate: jest.fn().mockResolvedValue(reviewDecision),
    } as unknown as AgentGatewayService;
    const controller = new SupervisorGatewayController(gateway);

    const workerInput: ValidateWorkerContextInput = {
      taskId: 'ATLAS-1',
      executionId: 'ATLAS-EXEC-1',
      externalWorker: 'codex',
      changedFiles: ['apps/api/src/example.ts'],
      requestedAction: 'edit_assigned_files',
    };
    const reviewInput: IntegrationGateInput = {
      taskId: 'ATLAS-2',
      executionId: 'ATLAS-EXEC-2',
      action: 'merge',
      targetBranch: 'production/atlas',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      changedFiles: ['apps/api/src/example.ts'],
      explicitUserAuthorization: false,
    };

    await expect(controller.validateWorker(workerInput)).resolves.toBe(
      workerDecision,
    );
    await expect(controller.checkReviewCandidate(reviewInput)).resolves.toBe(
      reviewDecision,
    );
    expect(gateway.validateWorkerContext).toHaveBeenCalledWith(workerInput);
    expect(gateway.checkReviewCandidate).toHaveBeenCalledWith(reviewInput);
    expect((controller as unknown as { checkIntegration?: unknown }).checkIntegration)
      .toBeUndefined();
  });
});
