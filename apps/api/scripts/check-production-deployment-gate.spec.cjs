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


test('shared deployment gate forwards branchless Railway provenance for Supervisor reservation validation', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_COMMIT_SHA: '9'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000007-1111-4111-8111-111111111111',
  };
  let request;

  await checkProductionDeploymentGate({
    env,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-branchless-api',
          executionId: 'exec-branchless-api',
        }),
      };
    },
  });

  const requestBody = JSON.parse(request.init.body);
  assert.equal(requestBody.service, 'api');
  assert.equal(requestBody.provenanceMode, 'supervisor_dispatch_reservation');
  assert.equal(requestBody.github.repositoryOwner, 'h7ysqm48cq-beep');
  assert.equal(requestBody.github.repositoryName, 'atlas-marketing-os');
  assert.equal(requestBody.github.branch, 'production/atlas');
  assert.equal(requestBody.github.commitSha, '9'.repeat(40));
});


test('shared deployment gate canonicalizes Railway main metadata only after exact canonical SHA proof', async () => {
  const sha = '7'.repeat(40);
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'main',
    RAILWAY_GIT_COMMIT_SHA: sha,
    RAILWAY_DEPLOYMENT_ID: '00000008-1111-4111-8111-111111111111',
  };
  let supervisorRequest;
  const receipt = await checkProductionDeploymentGate({
    env,
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('.git/info/refs?service=git-upload-pack')) {
        assert.equal(init.headers?.['x-atlas-supervisor-ci-token'], undefined);
        return {
          ok: true,
          status: 200,
          text: async () => sha + ' refs/heads/production/atlas\n',
        };
      }
      supervisorRequest = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-main-metadata',
          executionId: 'exec-main-metadata',
        }),
      };
    },
  });

  assert.deepEqual(receipt, {
    taskId: 'task-main-metadata',
    executionId: 'exec-main-metadata',
  });
  const body = JSON.parse(supervisorRequest.init.body);
  assert.equal(body.provenanceMode, 'supervisor_dispatch_reservation');
  assert.equal(body.github.branch, 'production/atlas');
  assert.equal(body.github.commitSha, sha);
});

for (const scenario of [
  {
    name: 'SHA mismatch',
    refs: '8'.repeat(40) + ' refs/heads/production/atlas\n',
    error: /canonical_production_branch_required/,
  },
  {
    name: 'missing production ref',
    refs: '0000',
    error: /canonical_production_ref_invalid/,
  },
  {
    name: 'canonical ref unavailable',
    status: 503,
    error: /canonical_production_ref_unavailable/,
  },
  {
    name: 'canonical ref network failure',
    offline: true,
    error: /canonical_production_ref_unavailable/,
  },
]) {
  test('shared deployment gate fails closed for Railway main metadata: ' + scenario.name, async () => {
    const env = {
      ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
      ATLAS_SUPERVISOR_CI_TOKEN: 'token',
      ATLAS_DEPLOYMENT_SERVICE: 'api',
      RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
      RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
      RAILWAY_GIT_BRANCH: 'main',
      RAILWAY_GIT_COMMIT_SHA: '7'.repeat(40),
      RAILWAY_DEPLOYMENT_ID: '00000009-1111-4111-8111-111111111111',
    };
    let supervisorCalls = 0;
    await assert.rejects(
      checkProductionDeploymentGate({
        env,
        fetchImpl: async (url) => {
          if (String(url).includes('.git/info/refs?service=git-upload-pack')) {
            if (scenario.offline) throw new Error('offline');
            return {
              ok: !scenario.status,
              status: scenario.status || 200,
              text: async () => scenario.refs,
            };
          }
          supervisorCalls += 1;
          throw new Error('supervisor must not be called');
        },
      }),
      scenario.error,
    );
    assert.equal(supervisorCalls, 0);
  });
}

test('shared deployment gate rejects noncanonical metadata from a different repository before Supervisor', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'untrusted',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'main',
    RAILWAY_GIT_COMMIT_SHA: '7'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000010-1111-4111-8111-111111111111',
  };
  let calls = 0;
  await assert.rejects(
    checkProductionDeploymentGate({
      env,
      fetchImpl: async () => {
        calls += 1;
        throw new Error('network must not be called');
      },
    }),
    /canonical_production_branch_required/,
  );
  assert.equal(calls, 0);
});

test('shared deployment gate forwards runtime_start phase for second-gate revalidation', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: '7'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000008-1111-4111-8111-111111111111',
  };
  let request;

  await checkProductionDeploymentGate({
    env,
    phase: 'runtime_start',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          allowed: true,
          taskId: 'task-runtime',
          executionId: 'exec-runtime',
        }),
      };
    },
  });

  const requestBody = JSON.parse(request.init.body);
  assert.equal(requestBody.phase, 'runtime_start');
  assert.equal(
    requestBody.deploymentId,
    '00000008-1111-4111-8111-111111111111',
  );
});

test('shared deployment gate fails closed on unsupported phase before resolver access', async () => {
  const env = {
    ATLAS_SUPERVISOR_API_URL: 'https://api.example.test',
    ATLAS_SUPERVISOR_CI_TOKEN: 'token',
    ATLAS_DEPLOYMENT_SERVICE: 'api',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: '8'.repeat(40),
    RAILWAY_DEPLOYMENT_ID: '00000009-1111-4111-8111-111111111111',
  };
  let calls = 0;

  await assert.rejects(
    checkProductionDeploymentGate({
      env,
      phase: 'invalid-phase',
      fetchImpl: async () => {
        calls += 1;
        throw new Error('should not run');
      },
    }),
    /ATLAS_DEPLOY_GATE_DENY unsupported_phase/,
  );

  assert.equal(calls, 0);
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
