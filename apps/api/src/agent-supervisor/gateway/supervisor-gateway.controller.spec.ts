import type {
  IntegrationGateInput,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import type { AgentGatewayService } from './agent-gateway.service';
import { SupervisorCiGuard } from './supervisor-ci.guard';
import { SupervisorDeployResolverGuard } from './supervisor-deploy-resolver.guard';
import { SupervisorGatewayController } from './supervisor-gateway.controller';
import type { SupervisorRunnerClaimService } from '../runner/supervisor-runner-claim.service';
import {
  SupervisorRunnerBootstrapGuard,
  SupervisorRunnerSessionGuard,
} from '../runner/supervisor-runner.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';

describe('SupervisorGatewayController', () => {
  function claims(overrides: Record<string, unknown> = {}) {
    return {
      claimNext: jest.fn(),
      heartbeat: jest.fn(),
      ...overrides,
    } as unknown as SupervisorRunnerClaimService;
  }

  it('splits CI, deploy resolver, and runner guards by route', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupervisorGatewayController),
    ).toBeUndefined();
    for (const handler of [
      SupervisorGatewayController.prototype.validateWorker,
      SupervisorGatewayController.prototype.checkReviewCandidate,
      SupervisorGatewayController.prototype.checkProductionDeployment,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        SupervisorCiGuard,
      ]);
    }
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        SupervisorGatewayController.prototype.resolveProductionDeployment,
      ),
    ).toEqual([SupervisorDeployResolverGuard]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        SupervisorGatewayController.prototype.createRunnerSession,
      ),
    ).toEqual([SupervisorRunnerBootstrapGuard]);
    for (const handler of [
      SupervisorGatewayController.prototype.claimNext,
      SupervisorGatewayController.prototype.heartbeat,
      SupervisorGatewayController.prototype.release,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        SupervisorRunnerSessionGuard,
      ]);
    }
  });

  it('keeps the production deployment gate behind the CI-protected gateway boundary', async () => {
    const decision = {
      allowed: true,
      reason: null,
      taskId: 'ATLAS-DEPLOY-1',
      executionId: 'ATLAS-DEPLOY-EXEC-1',
    };
    const checkProductionDeployment = jest.fn().mockResolvedValue(decision);
    const controller = new SupervisorGatewayController({
      checkProductionDeployment,
    } as unknown as AgentGatewayService, claims()) as unknown as {
      checkProductionDeployment?: (input: unknown) => Promise<unknown>;
    };
    const deploymentInput = {
      taskId: 'ATLAS-DEPLOY-1',
      executionId: 'ATLAS-DEPLOY-EXEC-1',
      service: 'api',
      github: {
        repositoryOwner: 'h7ysqm48cq-beep',
        repositoryName: 'atlas-marketing-os',
        branch: 'production/atlas',
        commitSha: 'a'.repeat(40),
      },
    };

    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        SupervisorGatewayController.prototype.checkProductionDeployment,
      ),
    ).toContain(SupervisorCiGuard);
    expect(typeof controller.checkProductionDeployment).toBe('function');
    await expect(
      controller.checkProductionDeployment!(deploymentInput),
    ).resolves.toBe(decision);
    expect(checkProductionDeployment).toHaveBeenCalledWith(deploymentInput);
  });

  it('exposes production deployment receipt resolution behind the CI gateway', async () => {
    const decision = {
      allowed: true,
      reason: null,
      taskId: 'ATLAS-DEPLOY-RESOLVE-1',
      executionId: 'ATLAS-DEPLOY-RESOLVE-EXEC-1',
    };
    const resolveProductionDeployment = jest.fn().mockResolvedValue(decision);
    const controller = new SupervisorGatewayController({
      resolveProductionDeployment,
    } as unknown as AgentGatewayService, claims()) as unknown as {
      resolveProductionDeployment?: (input: unknown) => Promise<unknown>;
    };
    const input = {
      service: 'api',
      github: {
        repositoryOwner: 'h7ysqm48cq-beep',
        repositoryName: 'atlas-marketing-os',
        branch: 'production/atlas',
        commitSha: 'a'.repeat(40),
      },
    };

    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        SupervisorGatewayController.prototype.resolveProductionDeployment,
      ),
    ).toContain(SupervisorDeployResolverGuard);
    expect(typeof controller.resolveProductionDeployment).toBe('function');
    await expect(controller.resolveProductionDeployment!(input)).resolves.toBe(
      decision,
    );
    expect(resolveProductionDeployment).toHaveBeenCalledWith(input);
  });

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
    const controller = new SupervisorGatewayController(gateway, claims());

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
    expect(
      (controller as unknown as { checkIntegration?: unknown })
        .checkIntegration,
    ).toBeUndefined();
    expect(
      (controller as unknown as { authorizeMerge?: unknown }).authorizeMerge,
    ).toBeUndefined();
  });

  it('derives claim, heartbeat, and release identity from the runner session', async () => {
    const claimResult = { claimed: false };
    const heartbeatResult = {
      claimEpoch: 4,
      leaseExpiresAt: '2026-09-07T10:02:00.000Z',
      capability: 'renewed-capability',
    };
    const claimNext = jest.fn().mockResolvedValue(claimResult);
    const heartbeat = jest.fn().mockResolvedValue(heartbeatResult);
    const release = jest.fn().mockResolvedValue({ released: true });
    const controller = new SupervisorGatewayController(
      {} as AgentGatewayService,
      claims({ claimNext, heartbeat, release }),
    );
    const request = { atlasRunnerId: 'engineering-runner:server-issued' };

    await expect(controller.claimNext(request)).resolves.toBe(claimResult);
    await expect(
      controller.heartbeat(request, 'ATLAS-EXEC-1', { claimEpoch: 4 }),
    ).resolves.toBe(heartbeatResult);
    await expect(controller.release(request, 'ATLAS-EXEC-1')).resolves.toEqual({
      released: true,
    });
    expect(claimNext).toHaveBeenCalledWith(request.atlasRunnerId);
    expect(heartbeat).toHaveBeenCalledWith(
      'ATLAS-EXEC-1',
      request.atlasRunnerId,
      4,
    );
    expect(release).toHaveBeenCalledWith('ATLAS-EXEC-1', request.atlasRunnerId);
  });
});
