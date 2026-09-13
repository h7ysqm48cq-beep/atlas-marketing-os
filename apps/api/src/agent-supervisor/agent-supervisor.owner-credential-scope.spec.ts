import {
  GUARDS_METADATA,
  MODULE_METADATA,
} from '@nestjs/common/constants';
import { AgentSupervisorController } from './agent-supervisor.controller';
import { AgentSupervisorModule } from './agent-supervisor.module';
import { SupervisorHumanOwnerCredentialGuard } from './gateway/supervisor-human-owner-credential.guard';
import { SupervisorOwnerActionGuard } from './gateway/supervisor-owner-action.guard';
import { SupervisorOwnerGuard } from './gateway/supervisor-owner.guard';

describe('Human Owner credential endpoint scope', () => {
  it('keeps the general Supervisor controller behind owner identity/action only', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AgentSupervisorController),
    ).toEqual([SupervisorOwnerActionGuard]);
  });

  it('injects and validates owner credential only on the two authorization endpoints', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AgentSupervisorController.prototype.authorizeMerge,
      ),
    ).toEqual([
      SupervisorHumanOwnerCredentialGuard,
      SupervisorOwnerGuard,
    ]);

    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AgentSupervisorController.prototype.authorizeProductionDeployment,
      ),
    ).toEqual([
      SupervisorHumanOwnerCredentialGuard,
      SupervisorOwnerGuard,
    ]);
  });

  it('does not attach owner credential guards to ordinary owner mutations', () => {
    for (const method of [
      'createTask',
      'startTask',
      'submitImplementation',
      'beginVerification',
      'markReadyForReview',
      'approveTask',
      'consumeMergeAuthorization',
      'revokeProductionDeploymentAuthorization',
      'dispatchTask',
      'markExecutionRunning',
      'completeExecution',
      'failExecution',
      'cancelExecution',
      'checkPermission',
    ] as const) {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          AgentSupervisorController.prototype[method],
        ),
      ).toBeUndefined();
    }
  });

  it('registers the endpoint credential guard as an API provider', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AgentSupervisorModule,
    ) as unknown[];

    expect(providers).toContain(SupervisorOwnerActionGuard);
    expect(providers).toContain(SupervisorHumanOwnerCredentialGuard);
    expect(providers).toContain(SupervisorOwnerGuard);
  });
});
