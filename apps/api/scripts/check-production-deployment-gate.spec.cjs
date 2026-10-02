'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkProductionDeploymentGate,
} = require('./check-production-deployment-gate.cjs');

test('shared deployment gate accepts engineering-verifier and forwards exact provenance', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'engineering-verifier',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000001-1111-4111-8111-111111111111',
  };
  let request;

  const receipt = await checkProductionDeploymentGate({
    env,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-verifier',
          executionId: 'exec-verifier',
        }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'task-verifier',
    executionId: 'exec-verifier',
  });
  const requestBody = JSON.parse(request.init.body);
  assert.equal(requestBody.service, 'engineering-verifier');
  assert.equal(requestBody.phase, 'pre_deploy');
  assert.equal(
    requestBody.deploymentId,
    '00000001-1111-4111-8111-111111111111',
  );
});

test('shared deployment gate retries only unresolved production authorization', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000002-1111-4111-8111-111111111111',
  };
  let calls = 0;
  const waits = [];

  const receipt = await checkProductionDeploymentGate({
    env,
    sleepImpl: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            code: 'production_deployment_resolution_not_found',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-api',
          executionId: 'exec-api',
        }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'task-api',
    executionId: 'exec-api',
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});

test('shared deployment gate retries pending owner deployment authorization', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000003-1111-4111-8111-111111111111',
  };
  let calls = 0;
  const waits = [];

  const receipt = await checkProductionDeploymentGate({
    env,
    sleepImpl: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            code: 'owner_deployment_authorization_required',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-api',
          executionId: 'exec-api',
        }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'task-api',
    executionId: 'exec-api',
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});

test('shared deployment gate bounds pending owner authorization retries', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'f'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000004-1111-4111-8111-111111111111',
  };
  let calls = 0;
  let waits = 0;

  await assert.rejects(
    checkProductionDeploymentGate({
      env,
      sleepImpl: async () => {
        waits += 1;
      },
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            code: 'owner_deployment_authorization_required',
          }),
        };
      },
    }),
    /ATLAS_DEPLOY_GATE_DENY owner_deployment_authorization_required/,
  );

  assert.equal(calls, 16);
  assert.equal(waits, 15);
});

test('shared deployment gate bounds unresolved authorization retries', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'c'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000005-1111-4111-8111-111111111111',
  };
  let calls = 0;
  let waits = 0;

  await assert.rejects(
    checkProductionDeploymentGate({
      env,
      sleepImpl: async () => {
        waits += 1;
      },
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            code: 'production_deployment_resolution_not_found',
          }),
        };
      },
    }),
    /ATLAS_DEPLOY_GATE_DENY production_deployment_resolution_not_found/,
  );

  assert.equal(calls, 16);
  assert.equal(waits, 15);
});

test('shared deployment gate does not retry service binding failures', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'web',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: 'd'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000006-1111-4111-8111-111111111111',
  };
  let calls = 0;
  let waits = 0;

  await assert.rejects(
    checkProductionDeploymentGate({
      env,
      sleepImpl: async () => {
        waits += 1;
      },
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            code: 'owner_deployment_authorization_service_mismatch',
          }),
        };
      },
    }),
    /owner_deployment_authorization_service_mismatch/,
  );

  assert.equal(calls, 1);
  assert.equal(waits, 0);
});



test('shared deployment gate canonicalizes Railway main metadata only for the exact production head', async () => {
  const sha = '7'.repeat(40);
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'main',
    RAILWAY_GIT_COMMIT_SHA: sha,
    RAILWAY_DEPLOYMENT_ID: '00000007-1111-4111-8111-111111111111',
  };
  let supervisorRequest = null;

  const receipt = await checkProductionDeploymentGate({
    env,
    fetchImpl: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('.git/info/refs?service=git-upload-pack')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `001e# service=git-upload-pack\n00000049${sha} refs/heads/production/atlas\n`,
        };
      }
      supervisorRequest = { href, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-detached',
          executionId: 'exec-detached',
        }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'task-detached',
    executionId: 'exec-detached',
  });
  const body = JSON.parse(supervisorRequest.init.body);
  assert.equal(body.github.branch, 'production/atlas');
  assert.equal(body.github.commitSha, sha);
});

test('shared deployment gate rejects Railway main metadata when the commit is not the production head', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'main',
    RAILWAY_GIT_COMMIT_SHA: '7'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000008-1111-4111-8111-111111111111',
  };
  let supervisorCalls = 0;

  await assert.rejects(
    checkProductionDeploymentGate({
      env,
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('.git/info/refs?service=git-upload-pack')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              `001e# service=git-upload-pack\n00000049${'8'.repeat(40)} refs/heads/production/atlas\n`,
          };
        }
        supervisorCalls += 1;
        throw new Error('supervisor must not be called');
      },
    }),
    /ATLAS_DEPLOY_GATE_DENY canonical_production_branch_required/,
  );

  assert.equal(supervisorCalls, 0);
});
