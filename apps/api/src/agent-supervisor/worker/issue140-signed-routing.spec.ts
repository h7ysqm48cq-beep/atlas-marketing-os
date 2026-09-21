import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { SupervisorWorkerBootstrapGuard } from './supervisor-worker-bootstrap.guard';
import { SupervisorSignedWorkerController } from './supervisor-signed-worker.controller';
import { SupervisorSignedReviewController } from '../system/supervisor-signed-review.controller';
import {
  SupervisorSystemGuard, SUPERVISOR_SYSTEM_PURPOSE,
} from '../system/supervisor-system.guard';
import { SupervisorWorkerBootstrapController } from './supervisor-worker-bootstrap.controller';
import { PrismaSupervisorLifecycleStore } from '../persistence/prisma-supervisor-lifecycle.store';
import { PrismaSupervisorExecutionStore } from '../persistence/prisma-supervisor-execution.store';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { AgentSupervisorModule } from '../agent-supervisor.module';
import { MODULE_METADATA } from '@nestjs/common/constants';

const actor = {
  kid: 'registered-key', principalId: 'registered-actor',
  controllingPrincipalId: 'registered-custodian',
  workerRole: 'engineering' as const,
  purposes: ['IMPLEMENTATION' as const],
};
const config = (required = true) => ({
  get: (key: string) => key === 'ATLAS_SUPERVISOR_SIGNED_ATTESTATION_MODE'
    ? (required ? 'required' : undefined) : undefined,
}) as ConfigService;
function setup(required = true) {
  const store = {
    issueOffer: jest.fn().mockResolvedValue('OFFER'),
    nextQueued: jest.fn().mockResolvedValue({ executionId: 'E' }),
    claimOffer: jest.fn().mockResolvedValue('CLAIMED'),
    completeSigned: jest.fn().mockResolvedValue('COMPLETED'),
    heartbeatSigned: jest.fn().mockResolvedValue('RENEWED'),
    terminateSigned: jest.fn().mockResolvedValue('FAILED'),
  };
  const worker = new SupervisorSignedWorkerController(
    store as never, config(required));
  return { store, worker, request: { supervisorAuthenticatedActor: actor } };
}

describe('Issue #140 signed-mode route selection: no role-only fallback', () => {
  it('signed worker endpoints use bootstrap guard and are public to that guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY,
      SupervisorSignedWorkerController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA,
      SupervisorSignedWorkerController)).toContain(
        SupervisorWorkerBootstrapGuard);
    expect(Reflect.getMetadata(PATH_METADATA,
      SupervisorSignedWorkerController)).toBe(
        'engineering/supervisor/worker/signed');
  });

  it('signed READY is SYSTEM guarded, purpose VERIFICATION_COORDINATION', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA,
      SupervisorSignedReviewController)).toContain(SupervisorSystemGuard);
    expect(Reflect.getMetadata(SUPERVISOR_SYSTEM_PURPOSE,
      SupervisorSignedReviewController.prototype.releaseReady))
      .toBe('VERIFICATION_COORDINATION');
    expect(Reflect.getMetadata(SUPERVISOR_SYSTEM_PURPOSE,
      SupervisorSignedReviewController.prototype.advance))
      .toBe('VERIFICATION_COORDINATION');
  });

  it('read-only queue discovery uses guard actor and never exposes other purpose', async () => {
    const { worker, request, store } = setup();
    await expect(worker.next(request, 'IMPLEMENTATION'))
      .resolves.toEqual({ executionId: 'E' });
    expect(store.nextQueued).toHaveBeenCalledWith({ actor,
      purpose: 'IMPLEMENTATION' });
    expect(() => worker.next(request, 'INDEPENDENT_VERIFICATION'))
      .toThrow('signed_worker_offer_invalid');
    expect(store.nextQueued).toHaveBeenCalledTimes(1);
  });

  it('rejects missing registry-authenticated actor, even in required mode', () => {
    const { worker, store } = setup();
    expect(() => worker.issueOffer({} as never, {
      executionId: 'E', purpose: 'IMPLEMENTATION',
    })).toThrow('signed_worker_actor_required');
    expect(store.issueOffer).not.toHaveBeenCalled();
  });

  it('rejects wrong purpose before database offer and never derives actor from body', () => {
    const { worker, store, request } = setup();
    expect(() => worker.issueOffer(request, {
      executionId: 'E', purpose: 'INDEPENDENT_VERIFICATION',
    })).toThrow('signed_worker_offer_invalid');
    expect(store.issueOffer).not.toHaveBeenCalled();
  });

  it('passes ONLY guard-derived identity to all five product store methods', async () => {
    const { worker, store, request } = setup();
    await worker.issueOffer(request, {
      executionId: 'E', purpose: 'IMPLEMENTATION',
    });
    await worker.claim(request, {
      challengeId: 'C', preclaimProof: {} as never,
      claimProof: {} as never,
    });
    await worker.heartbeat(request, {
      executionId: 'E', proof: {} as never,
    });
    await worker.terminate(request, {
      executionId: 'E', proof: {} as never,
    });
    await worker.complete(request, {
      executionId: 'E', result: {} as never,
      completionProof: {} as never,
    });
    for (const method of [
      store.issueOffer, store.claimOffer, store.heartbeatSigned,
      store.terminateSigned, store.completeSigned,
    ]) {
      expect(method).toHaveBeenCalledWith(
        expect.objectContaining({ actor }));
    }
  });

  it('disabled mode fails closed on new signed routes, not fake-enables proof', () => {
    const { worker, store, request } = setup(false);
    expect(() => worker.issueOffer(request, {
      executionId: 'E', purpose: 'IMPLEMENTATION',
    })).toThrow('signed_worker_mode_not_enabled');
    expect(store.issueOffer).not.toHaveBeenCalled();
  });

  it('system READY refuses disabled mode and invalid version', async () => {
    const releaseReady = jest.fn();
    const controller = new SupervisorSignedReviewController(
      { releaseReady } as never, config(false));
    expect(() => controller.releaseReady({
      taskId: 'T', expectedTaskVersion: new Date().toISOString(),
    })).toThrow('signed_review_mode_not_enabled');
    expect(releaseReady).not.toHaveBeenCalled();
    const enabled = new SupervisorSignedReviewController(
      { releaseReady } as never, config());
    expect(() => enabled.releaseReady({
      taskId: 'T', expectedTaskVersion: 'not-a-date',
    })).toThrow('signed_review_request_invalid');
    expect(releaseReady).not.toHaveBeenCalled();
  });

  it('legacy claim-next refuses required mode BEFORE the claim store', async () => {
    const claimNext = jest.fn();
    const original = new SupervisorWorkerBootstrapController(
      { claimNext } as never,
      { issue: jest.fn() } as never,
      { issue: jest.fn() } as never,
      { saveIfStatus: jest.fn() } as never,
      config(),
    );
    await expect(original.claimNext({
      supervisorWorkerBootstrapRole: 'engineering',
    } as never)).rejects.toThrow('signed_worker_claim_required');
    expect(claimNext).not.toHaveBeenCalled();
  });

  it('legacy markRunning refuses signed mode before reading execution', async () => {
    const get = jest.fn();
    const dispatcher = new WorkerDispatcherService(
      {} as never, { get } as never,
      {} as never, {} as never, config(),
    );
    await expect(dispatcher.markRunning('E'))
      .rejects.toThrow('signed_worker_claim_required');
    expect(get).not.toHaveBeenCalled();
  });

  it('legacy dispatcher complete refuses required mode before reading execution', async () => {
    const get = jest.fn();
    const dispatcher = new WorkerDispatcherService(
      {} as never, { get } as never,
      {} as never, {} as never, config(),
    );
    await expect(dispatcher.complete('E', {} as never))
      .rejects.toThrow('signed_worker_completion_required');
    expect(get).not.toHaveBeenCalled();
  });

  it('legacy supervisor markReady refuses required mode before loading task', async () => {
    const get = jest.fn();
    const supervisor = new AgentSupervisorService(
      { get } as never, {} as never, undefined, config(),
    );
    await expect(supervisor.markReadyForReview('T'))
      .rejects.toMatchObject({
        response: { code: 'signed_ready_review_required' },
      });
    expect(get).not.toHaveBeenCalled();
  });

  it('signed stores and guarded routes are registered in module metadata', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS,
      AgentSupervisorModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS,
      AgentSupervisorModule);
    expect(controllers).toContain(SupervisorSignedWorkerController);
    expect(controllers).toContain(SupervisorSignedReviewController);
    expect(providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provide:
        expect.objectContaining({ name: 'PrismaSupervisorExactClaimStore' }) }),
      expect.objectContaining({ provide:
        expect.objectContaining({ name: 'PrismaSupervisorSignedReviewStore' }) }),
    ]));
  });

  it('direct legacy Prisma claim/heartbeat are rejected before transaction', async () => {
    const transaction = jest.fn();
    const update = jest.fn();
    const store = new PrismaSupervisorExecutionStore({
      $transaction: transaction,
      supervisorExecution: { update },
    } as never, config());
    await expect(store.claimNext({} as never))
      .rejects.toThrow('signed_worker_claim_required');
    await expect(store.heartbeat({} as never))
      .rejects.toThrow('signed_worker_heartbeat_required');
    expect(transaction).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('direct legacy RUNNING/COMPLETED writes cannot bypass signatures', async () => {
    const update = jest.fn().mockRejectedValue(Error('test-only'));
    const store = new PrismaSupervisorExecutionStore({
      supervisorExecution: { update },
    } as never, config());
    for (const status of ['RUNNING', 'COMPLETED'] as const) {
      await expect(store.save({ status } as never))
        .rejects.toThrow('signed_execution_transition_required');
      await expect(store.saveIfStatus({ status } as never, 'QUEUED'))
        .rejects.toThrow('signed_execution_transition_required');
    }
    expect(update).not.toHaveBeenCalled();
    // Failure/cancellation recovery is not categorically denied by the flag.
    await expect(store.saveIfStatus({ status: 'FAILED' } as never,
      'RUNNING')).rejects.toBeDefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('legacy lifecycle refuses READY before entering transaction', async () => {
    const transaction = jest.fn();
    const lifecycle = new PrismaSupervisorLifecycleStore({
      $transaction: transaction,
    } as never, config());
    await expect(lifecycle.saveWithLocksIfUnchanged({
      status: 'READY_FOR_REVIEW',
    } as never, 'release', new Date(), true))
      .rejects.toMatchObject({
        response: { code: 'signed_ready_review_required' },
      });
    expect(transaction).not.toHaveBeenCalled();
  });
});
