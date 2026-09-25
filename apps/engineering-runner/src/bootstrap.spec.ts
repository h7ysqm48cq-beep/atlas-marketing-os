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

test('exact existing-candidate verification does not require frozenBaseSha or publisher credentials', async () => {
  const { createEngineeringRunnerOptions } = await import('./bootstrap.ts');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid', bootstrapToken: 'bootstrap',
    command: 'python3', args: [], workspace: '/legacy',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
    exactTarget: { taskId: 'ATLAS-TASK', executionId: 'ATLAS-EXEC' },
    candidate: {
      repositoryRoot: '/repo',
      workspaceRoot: '/workspaces',
      remote: 'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git',
    },
  };
  const options = createEngineeringRunnerOptions(config, { PATH: '/usr/bin' });
  const client = options.client as any;
  assert.equal(client.requireFrozenBaseSha, false);
  assert.equal(client.executionPurpose, 'INDEPENDENT_VERIFICATION');
  assert.deepEqual(client.exactTarget, config.exactTarget);
  assert.equal(options.singleShot, true);
  assert.ok(options.candidateWorkspaceManager);
  assert.equal(options.candidatePublisher, undefined);
  assert.equal(typeof options.executorFactory, 'function');
});


test('standing verifier runner claims independent verification without a publisher', async () => {
  const { createEngineeringRunnerOptions } = await import('./bootstrap.ts');
  const config: EngineeringRunnerConfig = {
    supervisorApiUrl: 'https://example.invalid', bootstrapToken: 'verifier-bootstrap',
    command: 'python3', args: [], workspace: '/legacy',
    pollIntervalMs: 1000, heartbeatIntervalMs: 2000,
    executionPurpose: 'INDEPENDENT_VERIFICATION',
    candidate: {
      repositoryRoot: '/repo',
      workspaceRoot: '/workspaces',
      remote: 'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git',
    },
  };
  const options = createEngineeringRunnerOptions(config, { PATH: '/usr/bin' });
  const client = options.client as any;
  assert.equal(client.executionPurpose, 'INDEPENDENT_VERIFICATION');
  assert.equal(client.requireFrozenBaseSha, false);
  assert.equal(client.exactTarget, undefined);
  assert.equal(options.singleShot, false);
  assert.ok(options.candidateWorkspaceManager);
  assert.equal(options.candidatePublisher, undefined);
  assert.equal(typeof options.executorFactory, 'function');
});
