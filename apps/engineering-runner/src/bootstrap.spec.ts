import test from 'node:test';
import assert from 'node:assert/strict';

import type { EngineeringRunnerConfig } from './config.ts';

test('candidate config wires isolated workspace, publisher, and cwd-bound executor factory', async () => {
  const module = await import('./bootstrap.ts').catch(() => ({}));
  const createOptions = (module as any).createEngineeringRunnerOptions;
  assert.ok(createOptions, 'createEngineeringRunnerOptions must exist');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid', bootstrapToken: 'bootstrap',
    command: 'python3', args: [], workspace: '/legacy',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
    candidate: {
      repositoryRoot: '/repo',
      workspaceRoot: '/workspaces',
      remote: 'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git',
      sourceToken: 'source-token',
      publisherToken: 'publisher-token',
    },
  };
  const options = createOptions(config, { PATH: '/usr/bin', HOME: '/tmp' });
  assert.equal((options.client as any).requireFrozenBaseSha, true);
  assert.equal(typeof options.preflight, 'function');
  assert.ok(options.candidateWorkspaceManager);
  assert.ok(options.candidatePublisher);
  assert.equal(typeof options.executorFactory, 'function');
  assert.ok(options.executorFactory('/isolated'));
});

test('legacy config leaves candidate flow dependencies absent', async () => {
  const { createEngineeringRunnerOptions } = await import('./bootstrap.ts');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid', bootstrapToken: 'bootstrap',
    command: 'python3', args: [], workspace: '/legacy',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
  };
  const options = createEngineeringRunnerOptions(config, { PATH: '/usr/bin' });
  assert.equal((options.client as any).requireFrozenBaseSha, false);
  assert.equal(options.preflight, undefined);
  assert.equal(options.candidateWorkspaceManager, undefined);
  assert.equal(options.candidatePublisher, undefined);
  assert.equal(options.executorFactory, undefined);
});
test('explicit signed config constructs private-key client without legacy fallback', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { SignedSupervisorClient } =
    await import('./signed-supervisor-client.ts');
  const { createEngineeringRunnerOptions } = await import('./bootstrap.ts');
  const pair = generateKeyPairSync('ed25519');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid',
    bootstrapToken: 'ACTOR_ONLY_TOKEN_NOT_SHARED',
    command: 'python3', args: [], workspace: '/legacy',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
    signed: {
      kid: 'distinct-implementer',
      purpose: 'IMPLEMENTATION',
      privateKeyPem: pair.privateKey.export({
        format: 'pem', type: 'pkcs8',
      }).toString(),
    },
  };
  const options = createEngineeringRunnerOptions(config, { PATH: '/usr/bin' });
  assert.ok(options.client instanceof SignedSupervisorClient);
  assert.equal(options.preflight, undefined);
});
test('signed mode invalid key blocks boot before executing tasks', async () => {
  const { createEngineeringRunnerOptions } = await import('./bootstrap.ts');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid',
    bootstrapToken: 'ACTOR_ONLY_TOKEN',
    command: 'python3', args: [], workspace: '/legacy',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
    signed: { kid: 'kid', purpose: 'IMPLEMENTATION',
      privateKeyPem: 'not a private key' },
  };
  assert.throws(() => createEngineeringRunnerOptions(config),
    /signed_runner_private_key_invalid/);
});

test('signed verifier constructs source-only frozen-head workflow without publisher authority', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { SignedSupervisorClient } =
    await import('./signed-supervisor-client.ts');
  const { createEngineeringRunnerOptions } = await import('./bootstrap.ts');
  const pair = generateKeyPairSync('ed25519');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid',
    bootstrapToken: 'VERIFIER_ACTOR_ONLY_TOKEN',
    command: 'python3', args: [], workspace: '/unused',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
    signed: {
      kid: 'verifier-kid', purpose: 'INDEPENDENT_VERIFICATION',
      privateKeyPem: pair.privateKey.export({
        format: 'pem', type: 'pkcs8',
      }).toString(),
    },
    verifierSource: {
      repositoryRoot: '/bare/repo',
      workspaceRoot: '/workspaces/verifier',
      remote: 'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git',
    },
  };
  const options = createEngineeringRunnerOptions(config, {
    PATH: '/usr/bin', HOME: '/private/denied',
  });
  assert.ok(options.client instanceof SignedSupervisorClient);
  assert.equal(typeof options.verifierWorkspaceManager?.prepare, 'function');
  assert.equal(typeof options.executorFactory, 'function');
  assert.equal(typeof options.preflight, 'function');
  assert.equal(options.candidatePublisher, undefined);
  assert.equal(options.candidateWorkspaceManager, undefined);
});
