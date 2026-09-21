import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { SignedSupervisorClient } from './signed-supervisor-client.ts';
import { EngineeringRunner } from './runner.ts';

const pair = generateKeyPairSync('ed25519');
const kid = 'local-workload-only';
const privateKeyPem = pair.privateKey.export({
  type: 'pkcs8', format: 'pem',
}).toString();
const E = 'EXEC-140-TEST';
const T = 'TASK-140-TEST';
const candidate = {
  action: 'merge' as const, targetBranch: 'production/atlas',
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  changedFiles: ['apps/api/src/a.ts'],
};
const receipt = {
  taskId: T, executionId: E,
  candidateBranch: 'atlas/candidate/' + T + '/' + E,
  baseSha: candidate.baseSha, headSha: candidate.headSha,
  changedFiles: ['apps/api/src/a.ts'],
  targetBranch: 'production/atlas' as const,
  remoteHeadSha: candidate.headSha, remoteVerified: true as const,
};
const result = {
  summary: 'local published implementation',
  evidence: {
    rootCause: 'test only', changedFiles: [...candidate.changedFiles],
    tests: ['PASS'], build: 'PASS', regression: [],
    deploymentState: 'NOT_DEPLOYED', gitState: 'SYNTHETIC_LOCAL_TEST',
    remainingRisk: [], reviewCandidate: candidate,
    candidatePublication: receipt,
  },
};
const claimBinding = {
  taskId: T, executionId: E,
  purpose: 'IMPLEMENTATION' as const,
  manifestHash: 'c'.repeat(64),
  claimEpoch: 1, runnerId: 'runner-140',
  leaseId: 'lease-140',
  claimNonce: 'n'.repeat(43),
  authenticatedAt: '2026-09-22T00:00:00.000Z',
  frozenBaseSha: candidate.baseSha,
};
const challenge = {
  id: '11111111-1111-4111-8111-111111111111',
  nonce: claimBinding.claimNonce,
  kid, workerRole: 'engineering',
  purpose: 'IMPLEMENTATION' as const,
  issuedAt: claimBinding.authenticatedAt,
  expiresAt: '2026-09-22T00:01:00.000Z',
};
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(record[key]),
  ).join(',') + '}';
}
function signatureValid(value: {
  kid: string; binding: unknown; signature: string;
}, domain: string) {
  return value.kid === kid &&
    verify(null, Buffer.from(canonical({
      domain, kid: value.kid, binding: value.binding,
    })), pair.publicKey, Buffer.from(value.signature, 'base64url'));
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function setup(options: {
  next?: unknown; badKid?: boolean; claimNetworkError?: boolean;
  purpose?: 'IMPLEMENTATION' | 'INDEPENDENT_VERIFICATION';
  terminalNetworkError?: boolean;
  heartbeatResponse?: () => Promise<Response>;
  completeMalformedResponse?: boolean;
  terminalGatewayFailure?: boolean;
} = {}) {
  const calls: Array<{ path: string; body: any; authorization: string }> = [];
  const client = new SignedSupervisorClient({
    baseUrl: 'https://api.example.test/',
    actorBootstrapToken: 'LOCAL_TEST_ACTOR_BOOTSTRAP_TOKEN',
    signingKid: kid, signingPrivateKeyPem: privateKeyPem,
    executionPurpose: options.purpose ?? 'IMPLEMENTATION',
    fetch: async (url, init) => {
      const path = String(url).replace('https://api.example.test', '');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const authorization = String(
        (init?.headers as Record<string, string>)?.authorization,
      );
      calls.push({ path, body, authorization });
      if (path.startsWith('/engineering/supervisor/worker/signed/next')) {
        return response(options.next === undefined
          ? { executionId: E } : options.next);
      }
      if (path.endsWith('/offer')) {
        return response({ challenge: { ...challenge,
          kid: options.badKid ? 'unexpected-kid' : kid,
          purpose: options.purpose ?? 'IMPLEMENTATION',
        }, claimBinding: { ...claimBinding,
          purpose: options.purpose ?? 'IMPLEMENTATION',
        }, ...(options.purpose === 'INDEPENDENT_VERIFICATION'
          ? { reviewCandidate: candidate,
              candidateBranch: 'atlas/candidate/' + T + '/IMPL-140-TEST' }
          : {}),
        });
      }
      if (path.endsWith('/claim')) {
        if (options.claimNetworkError) throw Error('network timeout');
        return response({ id: E, status: 'RUNNING', assignment: {
          ...claimBinding, workerRole: 'engineering',
          executionPurpose: options.purpose ?? 'IMPLEMENTATION',
          objective: 'test', allowedPaths: candidate.changedFiles,
          forbiddenActions: [], dependencies: [],
          acceptance: [], requiredEvidence: [],
        } });
      }
      if (path.endsWith('/heartbeat')) {
        return options.heartbeatResponse
          ? options.heartbeatResponse()
          : response({ id: E, status: 'RUNNING' });
      }
      if (path.endsWith('/complete')) {
        if (options.completeMalformedResponse) {
          return new Response('{broken-response', { status: 200 });
        }
        return response({ id: E, status: 'COMPLETED' });
      }
      if (path.endsWith('/terminate')) {
        if (options.terminalNetworkError) throw Error('network timeout');
        if (options.terminalGatewayFailure) {
          return response({ error: 'upstream response lost' }, 502);
        }
        return response({ id: E, status: body.proof.binding.status });
      }
      throw Error('UNEXPECTED_ROUTE:' + path);
    },
  });
  return { client, calls };
}
test('signed runner idle never calls legacy claim-next', async () => {
  const { client, calls } = setup({ next: null });
  assert.equal(await client.claimNext(), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /signed\/next/);
});
test('real Ed25519 preclaim + exact claim + heartbeat + completion, no legacy fallback', async () => {
  const { client, calls } = setup();
  const session = await client.claimNext();
  assert.ok(session);
  assert.equal(session.assignment.executionId, E);
  assert.equal(session.assignment.frozenBaseSha, candidate.baseSha);
  const postedClaim = calls.find(call => call.path.endsWith('/claim'))!.body;
  const preclaim = postedClaim.preclaimProof;
  assert.equal(preclaim.kid, kid);
  assert.equal(preclaim.challengeId, challenge.id);
  assert.equal(verify(null, Buffer.from(canonical({
    domain: 'atlas.actor.preclaim.v1',
    challenge,
  })), pair.publicKey, Buffer.from(preclaim.signature, 'base64url')), true);
  assert.ok(signatureValid(postedClaim.claimProof, 'atlas.actor.claim.v1'));
  await session.heartbeat();
  const heartbeat = calls.find(call =>
    call.path.endsWith('/heartbeat'))!.body.proof;
  assert.ok(signatureValid(heartbeat, 'atlas.actor.heartbeat.v1'));
  assert.deepEqual(heartbeat.binding, {
    taskId: T, executionId: E, claimEpoch: 1,
    runnerId: claimBinding.runnerId, leaseId: claimBinding.leaseId,
    claimNonce: challenge.nonce, issuedAt: heartbeat.binding.issuedAt,
  });
  await session.complete(result);
  const completion = calls.find(call =>
    call.path.endsWith('/complete'))!.body.completionProof;
  assert.ok(signatureValid(completion, 'atlas.actor.completion.v1'));
  assert.equal(completion.binding.claimProofDigest,
    createHash('sha256').update(canonical(postedClaim.claimProof)).digest('hex'));
  assert.equal(completion.binding.resultDigest,
    createHash('sha256').update(canonical(result)).digest('hex'));
  assert.deepEqual(completion.binding.candidate, candidate);
  assert.equal(calls.every(call =>
    call.authorization === 'Bearer LOCAL_TEST_ACTOR_BOOTSTRAP_TOKEN'), true);
  assert.equal(calls.some(call => call.path.includes('/claim-next')), false);
  await assert.rejects(session.complete(result), /already_terminal/);
});
test('independent verifier signs already frozen candidate from server offer', async () => {
  const { client, calls } = setup({ purpose: 'INDEPENDENT_VERIFICATION' });
  const session = await client.claimNext();
  assert.ok(session);
  assert.equal(session.purpose, 'INDEPENDENT_VERIFICATION');
  const verificationResult = { ...result, evidence: {
    ...result.evidence, reviewCandidate: undefined,
    candidatePublication: undefined,
  } };
  await session.complete(verificationResult);
  const posted = calls.find(call =>
    call.path.endsWith('/complete'))!.body;
  assert.ok(signatureValid(posted.completionProof,
    'atlas.actor.completion.v1'));
  assert.deepEqual(posted.completionProof.binding.candidate, candidate);
  assert.deepEqual(posted.result.evidence.reviewCandidate, candidate);
  assert.equal(posted.completionProof.binding.resultDigest,
    createHash('sha256').update(canonical(posted.result)).digest('hex'));
  assert.equal(calls.some(call => call.path.includes('/claim-next')), false);
});
test('bad server offer kid denies BEFORE signed claim', async () => {
  const { client, calls } = setup({ badKid: true });
  await assert.rejects(client.claimNext(), /signed_offer_challenge_invalid/);
  assert.equal(calls.some(call => call.path.endsWith('/claim')), false);
});
test('missing candidate refuses completion, without making a mutation', async () => {
  const { client, calls } = setup();
  const session = await client.claimNext();
  assert.ok(session);
  const incomplete = { ...result, evidence: {
    ...result.evidence, reviewCandidate: undefined,
  } };
  await assert.rejects(session.complete(incomplete),
    /signed_completion_candidate_required/);
  assert.equal(calls.some(call => call.path.endsWith('/complete')), false);
});
test('claim network ambiguity is never retried, and no legacy fallback', async () => {
  const { client, calls } = setup({ claimNetworkError: true });
  await assert.rejects(client.claimNext(), /supervisor_mutation_ambiguous:signed_claim/);
  assert.equal(calls.filter(call => call.path.endsWith('/claim')).length, 1);
  assert.equal(calls.some(call => call.path.includes('/claim-next')), false);
});
test('signed failure and cancellation have genuine Ed25519 terminal attestations', async () => {
  for (const status of ['FAILED', 'CANCELLED'] as const) {
    const { client, calls } = setup();
    const session = await client.claimNext();
    assert.ok(session);
    if (status === 'FAILED') await session.fail('real failure');
    else await session.cancel('runner aborted');
    const terminals = calls.filter(call => call.path.endsWith('/terminate'));
    assert.equal(terminals.length, 1);
    const proof = terminals[0].body.proof;
    assert.ok(signatureValid(proof, 'atlas.actor.terminal.v1'));
    assert.equal(proof.binding.status, status);
    assert.equal(proof.binding.taskId, T);
    assert.equal(proof.binding.claimEpoch, claimBinding.claimEpoch);
    assert.equal(proof.binding.leaseId, claimBinding.leaseId);
    assert.equal(proof.binding.claimNonce, claimBinding.claimNonce);
    await assert.rejects(session.complete(result), /already_terminal/);
    assert.equal(calls.some(call => call.path.endsWith('/complete')), false);
    assert.equal(calls.some(call => call.path.includes('/claim-next')), false);
  }
});
test('terminal network ambiguity is not retried or reported as success', async () => {
  const { client, calls } = setup({ terminalNetworkError: true });
  const session = await client.claimNext();
  assert.ok(session);
  await assert.rejects(session.fail('network timeout'),
    /supervisor_mutation_ambiguous:signed_terminate/);
  assert.equal(calls.filter(call => call.path.endsWith('/terminate')).length, 1);
  assert.equal(calls.some(call => call.path.endsWith('/complete')), false);
});
test('invalid terminal reason never reaches DB mutation', async () => {
  const { client, calls } = setup();
  const session = await client.claimNext();
  assert.ok(session);
  await assert.rejects(session.fail('   '), /signed_terminal_reason_invalid/);
  await assert.rejects(session.cancel('x'.repeat(1025)), /signed_terminal_reason_invalid/);
  assert.equal(calls.some(call => call.path.endsWith('/terminate')), false);
});
test('configuration rejects non-Ed25519 private key', () => {
  assert.throws(() => new SignedSupervisorClient({
    baseUrl: 'https://api.example.test',
    actorBootstrapToken: 'token',
    signingKid: kid, signingPrivateKeyPem: 'not-a-private-key',
    executionPurpose: 'IMPLEMENTATION',
  }), /signed_runner_private_key_invalid/);
});

function verifierWorkspaceFor(execute: () => Promise<never>) {
  return {
    verifierWorkspaceManager: { prepare: async () => ({
      path: '/local-only/verifier', baseSha: candidate.headSha,
      workspace: { listChangedFiles: async () => [] },
      cleanup: async () => undefined,
    }) },
    executorFactory: () => ({ execute }),
  };
}
test('actual EngineeringRunner.runOnce records a signed FAILED terminal', async () => {
  const { client, calls } = setup({ purpose: 'INDEPENDENT_VERIFICATION' });
  const runner = new EngineeringRunner({
    client,
    executor: { execute: async () => {
      throw Error('LOCAL_EXECUTION_FAILED');
    } },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope() {},
      assertVerificationNoDrift() {},
    },
    heartbeatIntervalMs: 20000,
    ...verifierWorkspaceFor(async () => {
      throw Error('LOCAL_EXECUTION_FAILED');
    }),
  });
  assert.equal(await runner.runOnce(), 'failed');
  const proof = calls.find(call => call.path.endsWith('/terminate'))!.body.proof;
  assert.ok(signatureValid(proof, 'atlas.actor.terminal.v1'));
  assert.equal(proof.binding.status, 'FAILED');
  assert.match(proof.binding.reason, /LOCAL_EXECUTION_FAILED/);
  assert.equal(calls.some(call => call.path.endsWith('/complete')), false);
});
test('actual EngineeringRunner.runOnce records a signed CANCELLED terminal', async () => {
  const { client, calls } = setup({ purpose: 'INDEPENDENT_VERIFICATION' });
  const controller = new AbortController();
  const runner = new EngineeringRunner({
    client,
    executor: { execute: async () => {
      controller.abort();
      throw Error('LOCAL_ABORTED');
    } },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope() {},
      assertVerificationNoDrift() {},
    },
    heartbeatIntervalMs: 20000,
    ...verifierWorkspaceFor(async () => {
      controller.abort();
      throw Error('LOCAL_ABORTED');
    }),
  });
  assert.equal(await runner.runOnce(controller.signal), 'cancelled');
  const proof = calls.find(call => call.path.endsWith('/terminate'))!.body.proof;
  assert.ok(signatureValid(proof, 'atlas.actor.terminal.v1'));
  assert.equal(proof.binding.status, 'CANCELLED');
  assert.equal(proof.binding.reason, 'runner_aborted');
});
test('EngineeringRunner never reports success on ambiguous signed failure', async () => {
  const { client, calls } = setup({
    purpose: 'INDEPENDENT_VERIFICATION',
    terminalNetworkError: true,
  });
  const runner = new EngineeringRunner({
    client,
    executor: { execute: async () => {
      throw Error('LOCAL_FAILURE_BEFORE_TERMINAL');
    } },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope() {},
      assertVerificationNoDrift() {},
    },
    heartbeatIntervalMs: 20000,
    ...verifierWorkspaceFor(async () => {
      throw Error('LOCAL_FAILURE_BEFORE_TERMINAL');
    }),
  });
  await assert.rejects(runner.runOnce(),
    /supervisor_mutation_ambiguous:signed_terminate/);
  assert.equal(calls.filter(call => call.path.endsWith('/terminate')).length, 1);
  assert.equal(calls.some(call => call.path.endsWith('/complete')), false);
});

test('signed heartbeat never sends overlapping out-of-order requests', async () => {
  let releaseFirst!: (value: Response) => void;
  let firstCalled!: () => void;
  const firstSeen = new Promise<void>(resolve => {
    firstCalled = resolve;
  });
  const firstResponse = new Promise<Response>(resolve => {
    releaseFirst = resolve;
  });
  const { client, calls } = setup({
    heartbeatResponse: (() => {
      let count = 0;
      return () => {
        count += 1;
        if (count === 1) {
          firstCalled();
          return firstResponse;
        }
        return Promise.resolve(response({ id: E, status: 'RUNNING' }));
      };
    })(),
  });
  const session = await client.claimNext();
  assert.ok(session);
  const first = session.heartbeat();
  await firstSeen;
  const second = session.heartbeat();
  await Promise.resolve();
  assert.equal(calls.filter(call => call.path.endsWith('/heartbeat')).length,
    1, 'second heartbeat MUST join in-flight request');
  releaseFirst(response({ id: E, status: 'RUNNING' }));
  await Promise.all([first, second]);
  await session.heartbeat();
  assert.equal(calls.filter(call => call.path.endsWith('/heartbeat')).length,
    2, 'next heartbeat may start only AFTER previous settled');
});

test('runner heartbeats during slow frozen verifier checkout BEFORE executor starts', async () => {
  const { client, calls } = setup({ purpose: 'INDEPENDENT_VERIFICATION' });
  let releasePrepare!: () => void;
  let enterPrepare!: () => void;
  const entered = new Promise<void>(resolve => { enterPrepare = resolve; });
  const prepared = new Promise<void>(resolve => { releasePrepare = resolve; });
  const runner = new EngineeringRunner({
    client,
    executor: { execute: async () => { throw Error('unused'); } },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope() {},
      assertVerificationNoDrift() {},
    },
    heartbeatIntervalMs: 20000,
    verifierWorkspaceManager: {
      prepare: async () => {
        enterPrepare();
        await prepared;
        return {
          path: '/local-only/slow-checkout',
          baseSha: candidate.headSha,
          workspace: { listChangedFiles: async () => [] },
          cleanup: async () => undefined,
        };
      },
    },
    executorFactory: () => ({ execute: async () => ({
      summary: 'verified slow checkout', evidence: {
        rootCause: 'none', changedFiles: [...candidate.changedFiles],
        tests: ['PASS'], build: 'PASS', regression: [],
        deploymentState: 'NOT_DEPLOYED', gitState: 'TEST_ONLY',
        remainingRisk: [],
      },
    }) }),
  });
  const running = runner.runOnce();
  await entered;
  assert.equal(calls.filter(call => call.path.endsWith('/heartbeat')).length,
    1, 'heartbeat must be established before slow candidate checkout');
  releasePrepare();
  assert.equal(await running, 'completed');
});

test('successful complete with broken response is ambiguous, not failed', async () => {
  const { client, calls } = setup({ completeMalformedResponse: true });
  const session = await client.claimNext();
  assert.ok(session);
  await assert.rejects(session.complete(result),
    /supervisor_mutation_ambiguous:signed_complete/);
  assert.equal(calls.filter(call => call.path.endsWith('/complete')).length,
    1);
  assert.equal(calls.some(call => call.path.endsWith('/terminate')), false);
});
test('terminal gateway 502 is ambiguous and cannot be retried as a new terminal', async () => {
  const { client, calls } = setup({ terminalGatewayFailure: true });
  const session = await client.claimNext();
  assert.ok(session);
  await assert.rejects(session.fail('worker stopped'),
    /supervisor_mutation_ambiguous:signed_terminate/);
  assert.equal(calls.filter(call => call.path.endsWith('/terminate')).length,
    1);
});

test('long executor failure records signed FAILED with bounded reason', async () => {
  const { client, calls } = setup({ purpose: 'INDEPENDENT_VERIFICATION' });
  const runner = new EngineeringRunner({
    client,
    executor: { execute: async () => { throw Error('unused'); } },
    workspace: { listChangedFiles: async () => [] },
    scopeGuard: {
      assertImplementationScope() {},
      assertVerificationNoDrift() {},
    },
    heartbeatIntervalMs: 20000,
    ...verifierWorkspaceFor(async () => {
      throw Error('BUILD_FAILED:' + 'x'.repeat(6000));
    }),
  });
  assert.equal(await runner.runOnce(), 'failed');
  const terminals = calls.filter(call => call.path.endsWith('/terminate'));
  assert.equal(terminals.length, 1);
  const proof = terminals[0].body.proof;
  assert.ok(signatureValid(proof, 'atlas.actor.terminal.v1'));
  assert.equal(proof.binding.status, 'FAILED');
  assert.ok(proof.binding.reason.length <= 1024);
  assert.match(proof.binding.reason, /BUILD_FAILED/);
});
