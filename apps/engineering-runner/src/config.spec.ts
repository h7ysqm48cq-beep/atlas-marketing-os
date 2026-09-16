import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngineeringRunnerConfig } from './config.ts';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ATLAS_SUPERVISOR_API_URL: 'https://example.invalid',
    ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN: 'bootstrap',
    ATLAS_ENGINEERING_RUNNER_COMMAND: 'python3',
    ATLAS_ENGINEERING_RUNNER_ARGS: '[]',
    ATLAS_ENGINEERING_RUNNER_WORKSPACE: '/legacy/workspace',
  };
}

test('candidate publication config is optional when all candidate keys are absent', () => {
  const config = loadEngineeringRunnerConfig(baseEnv()) as any;
  assert.equal(config.candidate, undefined);
});

test('candidate publication config loads only as a complete tuple', () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = '/repo';
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = '/workspaces';
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE = 'origin';
  const config = loadEngineeringRunnerConfig(env) as any;
  assert.deepEqual(config.candidate, {
    repositoryRoot: '/repo',
    workspaceRoot: '/workspaces',
    remote: 'origin',
  });
});

test('candidate publication config fails closed when only some candidate keys are present', () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = '/repo';
  assert.throws(
    () => loadEngineeringRunnerConfig(env),
    /runner_candidate_config_incomplete/,
  );
});