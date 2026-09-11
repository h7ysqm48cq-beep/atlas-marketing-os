import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  SupervisorExecutionAuthorityBinding,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';
import { canonicalizeAuthorityValue } from './supervisor-authority.service';

export type SupervisorAdmissionManifestInput = Omit<
  WorkerAssignmentEnvelope,
  | 'manifestHash'
  | 'claimEpoch'
  | 'leaseId'
  | 'runnerId'
  | 'workerCapability'
>;

@Injectable()
export class SupervisorAdmissionManifestService {
  createBinding(
    input: SupervisorAdmissionManifestInput,
  ): SupervisorExecutionAuthorityBinding {
    const claimEpoch = 0;
    const leaseId = randomUUID();
    const runnerId = randomUUID();

    const manifestHash = createHash('sha256')
      .update(
        canonicalizeAuthorityValue({
          version: 1,
          ...input,
          claimEpoch,
          leaseId,
          runnerId,
        }),
        'utf8',
      )
      .digest('hex');

    return Object.freeze({
      manifestHash,
      claimEpoch,
      leaseId,
      runnerId,
    });
  }
}
