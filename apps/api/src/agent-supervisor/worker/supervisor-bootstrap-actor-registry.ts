import { ForbiddenException } from '@nestjs/common';
import type { SupervisorWorkerRole, SupervisorExecutionPurpose } from '../execution/supervisor-execution.types';

/**
 * Config-owned bootstrap credentials; never accept a claimed actorId
 * or controlling principal from a request body/header.
 * This is a first-hop actor binding, NOT independent-verifier attestation.
 */
export interface ConfiguredBootstrapActor {
  kid: string;
  principalId: string;
  controllingPrincipalId: string;
  workerRole: SupervisorWorkerRole;
  purposes: SupervisorExecutionPurpose[];
  token: string;
}

export type AuthenticatedBootstrapActor = Omit<ConfiguredBootstrapActor, 'token'>;

/** Identity metadata recorded at atomic claim; not a signed execution attestation. */
export interface BootstrapActorClaim extends AuthenticatedBootstrapActor {
  authenticatedAt: string;
  claimNonce: string;
}

const ROLES = new Set<string>([
  'engineering', 'frontend', 'backend', 'database', 'qa', 'infra',
]);
const PURPOSES = new Set<string>(['IMPLEMENTATION', 'INDEPENDENT_VERIFICATION']);

export function parseBootstrapActorRegistry(raw: string | undefined):
  ConfiguredBootstrapActor[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new ForbiddenException('worker_actor_registry_invalid'); }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ForbiddenException('worker_actor_registry_invalid');
  }
  const ids = new Set<string>();
  const tokens = new Set<string>();
  return parsed.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ForbiddenException('worker_actor_registry_invalid');
    }
    const actor = entry as Record<string, unknown>;
    const strings = ['kid', 'principalId', 'controllingPrincipalId', 'token'];
    if (strings.some(k => typeof actor[k] !== 'string' ||
        !(actor[k] as string).trim()) ||
        !ROLES.has(actor.workerRole as string) ||
        !Array.isArray(actor.purposes) || actor.purposes.length === 0 ||
        actor.purposes.some(p => typeof p !== 'string' || !PURPOSES.has(p)) ||
        new Set(actor.purposes).size !== actor.purposes.length ||
        (actor.token as string).length < 32 ||
        Object.keys(actor).some(k =>
          ![...strings, 'workerRole', 'purposes'].includes(k)) ||
        ids.has(actor.kid as string) || tokens.has(actor.token as string)) {
      throw new ForbiddenException('worker_actor_registry_invalid');
    }
    ids.add(actor.kid as string);
    tokens.add(actor.token as string);
    return actor as unknown as ConfiguredBootstrapActor;
  });
}

export function publicActorBinding(
  entry: ConfiguredBootstrapActor,
): AuthenticatedBootstrapActor {
  const { token: _credential, ...safe } = entry;
  return {
    ...safe,
    purposes: [...safe.purposes],
  };
}
