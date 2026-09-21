import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { ConfigTrustedActorRegistry } from './verification/config-trusted-actor-registry';
import { GitHubCandidatePublicationVerifier } from './verification/github-candidate-publication-verifier';
import { PrismaSupervisorExactClaimStore } from './persistence/prisma-supervisor-exact-claim.store';
import { PrismaSupervisorSignedReviewStore } from './persistence/prisma-supervisor-signed-review.store';
import { SupervisorSignedWorkerController } from './worker/supervisor-signed-worker.controller';
import { SupervisorSignedReviewController } from './system/supervisor-signed-review.controller';
import { SupervisorSignedCoordinationService } from './system/supervisor-signed-coordination.service';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorService } from './agent-supervisor.service';
import { WorkerDispatcherService } from './dispatch/worker-dispatcher.service';
import { ProductionDeploymentGateService } from './deployment/production-deployment-gate.service';
import { AgentGatewayService } from './gateway/agent-gateway.service';
import { SupervisorCiGuard } from './gateway/supervisor-ci.guard';
import { SupervisorGatewayController } from './gateway/supervisor-gateway.controller';
import { SupervisorOwnerActionGuard } from './gateway/supervisor-owner-action.guard';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';
import { PrismaFileOwnershipStore } from './persistence/prisma-file-ownership.store';
import { PrismaSupervisorExecutionStore } from './persistence/prisma-supervisor-execution.store';
import { PrismaSupervisorLifecycleStore } from './persistence/prisma-supervisor-lifecycle.store';
import { PrismaSupervisorTaskStore } from './persistence/prisma-supervisor-task.store';
import { SupervisorExecutionReconcilerService } from './reconciliation/supervisor-execution-reconciler.service';
import { FILE_OWNERSHIP_STORE } from './stores/file-ownership.store';
import {
  SUPERVISOR_EXECUTION_CLAIM_STORE,
  SUPERVISOR_EXECUTION_HEARTBEAT_STORE,
  SUPERVISOR_EXECUTION_RECONCILIATION_STORE,
  SUPERVISOR_EXECUTION_STORE,
} from './stores/supervisor-execution.store';
import {
  SUPERVISOR_EXECUTION_RECOVERY_STORE,
  SUPERVISOR_LIFECYCLE_STORE,
} from './stores/supervisor-lifecycle.store';
import { SUPERVISOR_TASK_STORE } from './stores/supervisor-task.store';
import { SupervisorWorkerCapabilityService } from './worker/supervisor-worker-capability.service';
import { SupervisorWorkerController } from './worker/supervisor-worker.controller';
import { SupervisorWorkerGuard } from './worker/supervisor-worker.guard';
import { SupervisorWorkerBootstrapController } from './worker/supervisor-worker-bootstrap.controller';
import { SupervisorWorkerBootstrapGuard } from './worker/supervisor-worker-bootstrap.guard';
import { SupervisorVerifierController } from './worker/supervisor-verifier.controller';
import { SupervisorVerifierGuard } from './worker/supervisor-verifier.guard';
import {
  ConfigHumanOwnerApprovalKeyRegistry,
  HUMAN_OWNER_APPROVAL_KEYRING,
  SupervisorAuthorityKeyRegistry,
} from './authority/authority-key-registry';
import { SupervisorAdmissionManifestService } from './authority/supervisor-admission-manifest.service';
import { HumanOwnerApprovalService } from './authority/human-owner-approval.service';
import {
  SUPERVISOR_AUTHORITY_KEYRING,
  SupervisorAuthorityService,
} from './authority/supervisor-authority.service';
import { VerifierCapabilityService } from './authority/verifier-capability.service';
import { SupervisorSystemAdmissionService } from './system/supervisor-system-admission.service';
import { SupervisorSystemController } from './system/supervisor-system.controller';
import { SupervisorSystemGuard } from './system/supervisor-system.guard';

@Module({
  controllers: [
    AgentSupervisorController,
    SupervisorGatewayController,
    SupervisorWorkerController,
    SupervisorWorkerBootstrapController,
    SupervisorVerifierController,
    SupervisorSystemController,
    SupervisorSignedWorkerController,
    SupervisorSignedReviewController,
  ],
  providers: [
    AgentSupervisorService,
    WorkerDispatcherService,
    ProductionDeploymentGateService,
    AgentGatewayService,
    SupervisorCiGuard,
    SupervisorOwnerActionGuard,
    SupervisorOwnerGuard,
    SupervisorWorkerCapabilityService,
    SupervisorWorkerGuard,
    SupervisorWorkerBootstrapGuard,
    SupervisorVerifierGuard,
    SupervisorAdmissionManifestService,
    SupervisorAuthorityService,
    HumanOwnerApprovalService,
    VerifierCapabilityService,
    SupervisorSystemAdmissionService,
    SupervisorSystemGuard,
    SupervisorSignedCoordinationService,
    ConfigTrustedActorRegistry,
    GitHubCandidatePublicationVerifier,
    {
      provide: PrismaSupervisorExactClaimStore,
      useFactory: (prisma: PrismaService, keys: ConfigTrustedActorRegistry) =>
        new PrismaSupervisorExactClaimStore(prisma, keys),
      inject: [PrismaService, ConfigTrustedActorRegistry],
    },
    {
      provide: PrismaSupervisorSignedReviewStore,
      useFactory: (prisma: PrismaService, keys: ConfigTrustedActorRegistry,
        publication: GitHubCandidatePublicationVerifier) =>
        new PrismaSupervisorSignedReviewStore(prisma, keys, publication),
      inject: [PrismaService, ConfigTrustedActorRegistry,
        GitHubCandidatePublicationVerifier],
    },
    {
      provide: SUPERVISOR_AUTHORITY_KEYRING,
      useFactory: (config: ConfigService) =>
        new SupervisorAuthorityKeyRegistry(
          config,
        ),
      inject: [ConfigService],
    },
    {
      provide: HUMAN_OWNER_APPROVAL_KEYRING,
      useFactory: (config: ConfigService) =>
        new ConfigHumanOwnerApprovalKeyRegistry(
          config,
        ),
      inject: [ConfigService],
    },
    PrismaSupervisorTaskStore,
    PrismaSupervisorExecutionStore,
    PrismaFileOwnershipStore,
    PrismaSupervisorLifecycleStore,
    SupervisorExecutionReconcilerService,
    {
      provide: SUPERVISOR_TASK_STORE,
      useExisting: PrismaSupervisorTaskStore,
    },
    {
      provide: SUPERVISOR_EXECUTION_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    },
    {
      provide: SUPERVISOR_EXECUTION_CLAIM_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    },
    {
      provide: SUPERVISOR_EXECUTION_HEARTBEAT_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    },
    {
      provide: SUPERVISOR_EXECUTION_RECONCILIATION_STORE,
      useExisting: PrismaSupervisorExecutionStore,
    },
    {
      provide: FILE_OWNERSHIP_STORE,
      useExisting: PrismaFileOwnershipStore,
    },
    {
      provide: SUPERVISOR_LIFECYCLE_STORE,
      useExisting: PrismaSupervisorLifecycleStore,
    },
    {
      provide: SUPERVISOR_EXECUTION_RECOVERY_STORE,
      useExisting: PrismaSupervisorLifecycleStore,
    },
  ],
  exports: [
    AgentSupervisorService,
    WorkerDispatcherService,
    AgentGatewayService,
    SUPERVISOR_TASK_STORE,
    SUPERVISOR_EXECUTION_STORE,
    FILE_OWNERSHIP_STORE,
    SUPERVISOR_LIFECYCLE_STORE,
    SupervisorAuthorityService,
    VerifierCapabilityService,
    SUPERVISOR_EXECUTION_CLAIM_STORE,
    SUPERVISOR_EXECUTION_HEARTBEAT_STORE,
    SUPERVISOR_EXECUTION_RECONCILIATION_STORE,
    SUPERVISOR_EXECUTION_RECOVERY_STORE,
    SupervisorExecutionReconcilerService,
  ],
})
export class AgentSupervisorModule {}
