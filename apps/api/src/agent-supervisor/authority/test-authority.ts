import { generateKeyPairSync } from 'node:crypto';
import {
  InMemoryAuthorityKeyRegistry,
  SupervisorAuthorityService,
} from './supervisor-authority.service';

export function createTestSupervisorAuthority(): SupervisorAuthorityService {
  const fixture = () => {
    const pair = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: pair.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString(),
      publicKeyPem: pair.publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
    };
  };

  return new SupervisorAuthorityService(
    { get: () => undefined } as never,
    new InMemoryAuthorityKeyRegistry({
      SUPERVISOR_SYSTEM: fixture(),
      WORKER_CAPABILITY: fixture(),
      VERIFIER_CAPABILITY: fixture(),
      MERGE_APPROVAL: fixture(),
      DEPLOY_APPROVAL: fixture(),
    }),
  );
}
