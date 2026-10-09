import type {
  IntegrationGateInput,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import type { AgentGatewayService } from './agent-gateway.service';
import { SupervisorCiGuard } from './supervisor-ci.guard';
import { SupervisorGatewayController } from './supervisor-gateway.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';

describe('SupervisorGatewayController', () => {
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
    } as unknown as AgentGatewayService, {} as never) as unknown as {
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
      Reflect.getMetadata(GUARDS_METADATA, SupervisorGatewayController),
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
    } as unknown as AgentGatewayService, {} as never) as unknown as {
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
      Reflect.getMetadata(GUARDS_METADATA, SupervisorGatewayController),
    ).toContain(SupervisorCiGuard);
    expect(typeof controller.resolveProductionDeployment).toBe('function');
    await expect(controller.resolveProductionDeployment!(input)).resolves.toBe(
      decision,
    );
    expect(resolveProductionDeployment).toHaveBeenCalledWith(input);
  });

  it('exposes bounded production deployment qualification behind the CI gateway', async () => {
    const result = {
      service: 'engineering-runner',
      commitSha: 'a'.repeat(40),
      taskId: 'ATLAS-SYS-11111111-1111-1111-1111-111111111111',
      taskStatus: 'VERIFYING',
      executionId: 'ATLAS-EXEC-1',
      executionStatus: 'QUEUED',
    };
    const qualifyProductionDeployment = jest.fn().mockResolvedValue(result);
    const controller = new SupervisorGatewayController({
      qualifyProductionDeployment,
    } as unknown as AgentGatewayService, {} as never) as unknown as {
      qualifyProductionDeployment?: (input: unknown) => Promise<unknown>;
    };
    const input = {
      service: 'engineering-runner',
      github: {
        repositoryOwner: 'h7ysqm48cq-beep',
        repositoryName: 'atlas-marketing-os',
        branch: 'production/atlas',
        commitSha: 'a'.repeat(40),
      },
    };

    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupervisorGatewayController),
    ).toContain(SupervisorCiGuard);
    expect(typeof controller.qualifyProductionDeployment).toBe('function');
    await expect(
      controller.qualifyProductionDeployment!(input),
    ).resolves.toBe(result);
    expect(qualifyProductionDeployment).toHaveBeenCalledWith(input);
  });

  it('exposes trusted post-merge consumption only behind the CI-protected gateway boundary', async () => {
    const decision = {
      allowed: true,
      reason: null,
      taskId: 'ATLAS-MERGE-1',
      executionId: 'ATLAS-MERGE-EXEC-1',
    };
    const consumeTrustedMergeAuthorization = jest
      .fn()
      .mockResolvedValue(decision);
    const controller = new SupervisorGatewayController({
      consumeTrustedMergeAuthorization,
    } as unknown as AgentGatewayService, {} as never) as unknown as {
      consumeTrustedMergeAuthorization?: (input: unknown) => Promise<unknown>;
    };
    const input = {
      taskId: 'ATLAS-MERGE-1',
      executionId: 'ATLAS-MERGE-EXEC-1',
      action: 'merge',
      targetBranch: 'production/atlas',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      changedFiles: ['apps/api/src/example.ts'],
      attestation: {
        pullRequestNumber: 104,
        mergeCommitSha: 'd'.repeat(40),
        mergeParents: ['a'.repeat(40), 'b'.repeat(40)],
        mergedAt: '2026-09-14T00:01:00.000Z',
      },
    };

    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupervisorGatewayController),
    ).toContain(SupervisorCiGuard);
    expect(typeof controller.consumeTrustedMergeAuthorization).toBe('function');
    await expect(
      controller.consumeTrustedMergeAuthorization!(input),
    ).resolves.toBe(decision);
    expect(consumeTrustedMergeAuthorization).toHaveBeenCalledWith(input);
  });

  it('records deploy-daemon heartbeat telemetry behind the CI gateway', () => {
    const record = jest.fn().mockReturnValue({
      service: 'production-deploy-executor',
      phase: 'cycle_complete',
      cycle: 2,
      receivedAt: '2026-10-07T15:30:00.000Z',
    });
    const controller = new SupervisorGatewayController(
      {} as AgentGatewayService,
      { record } as never,
    );
    const input = {
      service: 'production-deploy-executor',
      phase: 'cycle_complete' as const,
      cycle: 2,
      commitSha: 'a'.repeat(40),
      claimedWork: false,
      nextPollMs: 120_000,
    };

    expect(controller.recordDeploymentAutomationHeartbeat(input)).toEqual(
      expect.objectContaining({
        service: 'production-deploy-executor',
        phase: 'cycle_complete',
        cycle: 2,
      }),
    );
    expect(record).toHaveBeenCalledWith(input);
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
    const controller = new SupervisorGatewayController(gateway, {} as never);

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
});
