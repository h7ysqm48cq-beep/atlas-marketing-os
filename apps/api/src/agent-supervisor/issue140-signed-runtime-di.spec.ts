import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AgentSupervisorModule } from './agent-supervisor.module';
import { AgentSupervisorService } from './agent-supervisor.service';
import { AgentGatewayService } from './gateway/agent-gateway.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { SupervisorSignedCoordinationService } from './system/supervisor-signed-coordination.service';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { SupervisorAuthorityService } from './authority/supervisor-authority.service';
import { ConfigTrustedActorRegistry } from './verification/config-trusted-actor-registry';
import { GitHubCandidatePublicationVerifier } from './verification/github-candidate-publication-verifier';
import { PrismaSupervisorExactClaimStore } from './persistence/prisma-supervisor-exact-claim.store';
import { PrismaSupervisorSignedReviewStore } from './persistence/prisma-supervisor-signed-review.store';
import { SupervisorWorkerBootstrapGuard } from './worker/supervisor-worker-bootstrap.guard';
import { SupervisorSystemGuard } from './system/supervisor-system.guard';
import { SupervisorSignedWorkerController } from './worker/supervisor-signed-worker.controller';
import { SupervisorSignedReviewController } from './system/supervisor-signed-review.controller';

describe('Issue #140 Nest container can create complete signed runtime graph', () => {
  it('instantiates BOTH controllers, guards, product stores and remote verifier', async () => {
    const config = {
      get: (key: string) => key ===
        'ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE' ? 'required' : undefined,
    };
    const registered = Reflect.getMetadata(MODULE_METADATA.PROVIDERS,
      AgentSupervisorModule) as Array<unknown>;
    const actualFactory = (token: unknown) => {
      const match = registered.find((entry: unknown) =>
        !!entry && typeof entry === 'object' &&
        'provide' in entry && entry.provide === token);
      if (!match) throw new Error('real_signed_provider_registration_missing');
      return match as Provider;
    };
    const module = await Test.createTestingModule({
      controllers: [
        SupervisorSignedWorkerController, SupervisorSignedReviewController,
      ],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: {} },
        { provide: AgentSupervisorService, useValue: {} },
        { provide: AgentGatewayService, useValue: {} },
        { provide: WorkerDispatcherService, useValue: {} },
        SupervisorSignedCoordinationService,
        { provide: SupervisorAuthorityService,
          useValue: { verify: jest.fn() } },
        ConfigTrustedActorRegistry, GitHubCandidatePublicationVerifier,
        SupervisorWorkerBootstrapGuard, SupervisorSystemGuard,
        Reflector,
        // Use EXACT factories from AgentSupervisorModule, not test copies.
        actualFactory(PrismaSupervisorExactClaimStore),
        actualFactory(PrismaSupervisorSignedReviewStore),
      ],
    }).compile();
    expect(module.get(SupervisorSignedWorkerController))
      .toBeInstanceOf(SupervisorSignedWorkerController);
    expect(module.get(SupervisorSignedReviewController))
      .toBeInstanceOf(SupervisorSignedReviewController);
    expect(module.get(SupervisorSignedCoordinationService))
      .toBeInstanceOf(SupervisorSignedCoordinationService);
    expect(module.get(GitHubCandidatePublicationVerifier))
      .toBeInstanceOf(GitHubCandidatePublicationVerifier);
    expect(module.get(SupervisorWorkerBootstrapGuard))
      .toBeInstanceOf(SupervisorWorkerBootstrapGuard);
    expect(module.get(SupervisorSystemGuard))
      .toBeInstanceOf(SupervisorSystemGuard);
    await module.close();
  });
});
