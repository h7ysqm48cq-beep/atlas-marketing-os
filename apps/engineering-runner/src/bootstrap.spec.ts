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
    candidate: { repositoryRoot: '/repo', workspaceRoot: '/workspaces', remote: 'origin' },
  };
  const options = createOptions(config, { PATH: '/usr/bin', HOME: '/tmp' });
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
  assert.equal(options.candidateWorkspaceManager, undefined);
  assert.equal(options.candidatePublisher, undefined);
  assert.equal(options.executorFactory, undefined);
});