'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runPreDeploy, exactBootstrapAuthorization } =
  require('./check-production-deployment-bootstrap.cjs');

const SHA = 'a'.repeat(40);
function fixture(service = 'api') {
  return {
    ATLAS_DEPLOYMENT_SERVICE: service,
    ATLAS_BOOTSTRAP_RELEASE_SHA: SHA,
    RAILWAY_PROJECT_ID: '693a96a8-fb2f-4e6d-af3b-fa2b54da49fc',
    RAILWAY_ENVIRONMENT_ID: '62379618-8890-40fb-bff8-2db75c57027c',
    RAILWAY_SERVICE_ID: service === 'api'
      ? 'c23120f6-5d60-44d6-8021-9d6c52387718'
      : 'a8413c73-cc42-483a-9932-c5b644665cf4',
    RAILWAY_GIT_REPO_OWNER: 'h7ysqm48cq-beep',
    RAILWAY_GIT_REPO_NAME: 'atlas-marketing-os',
    RAILWAY_GIT_BRANCH: 'production/atlas',
    RAILWAY_GIT_COMMIT_SHA: SHA,
  };
}

for (const service of ['api', 'engineering-runner']) {
  test(service + ' admits only exact scoped bootstrap without migrations', async () => {
    let gateCalls = 0; let migrations = 0;
    const actual = await runPreDeploy({
      env: fixture(service),
      checkGate: async () => { gateCalls++; return { taskId: 'fake' }; },
      migrate: () => { migrations++; },
    });
    assert.equal(actual.mode, 'BOOTSTRAP_EXCEPTION');
    assert.equal(actual.service, service);
    assert.equal(actual.commitSha, SHA);
    assert.equal(gateCalls, 0);
    assert.equal(migrations, 0);
  });

  test(service + ' defaults to real gate absent exact exception flag', async () => {
    const env = fixture(service);
    delete env.ATLAS_BOOTSTRAP_RELEASE_SHA;
    let gates = 0; let migrations = 0;
    const actual = await runPreDeploy({
      env, checkGate: async () => { gates++; return { taskId: 'real' }; },
      migrate: () => { migrations++; },
    });
    assert.equal(actual.mode, 'NORMAL_SUPERVISOR_GATE');
    assert.equal(gates, 1);
    assert.equal(migrations, service === 'api' ? 1 : 0);
  });

  test(service + ' cannot run migrations when normal gate denies', async () => {
    const env = fixture(service);
    delete env.ATLAS_BOOTSTRAP_RELEASE_SHA;
    let migrations = 0;
    await assert.rejects(
      runPreDeploy({
        env, checkGate: async () => { throw Error('gate_denied'); },
        migrate: () => { migrations++; },
      }), /gate_denied/,
    );
    assert.equal(migrations, 0);
  });
}

for (const key of [
  'RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID',
  'RAILWAY_GIT_REPO_OWNER','RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_BRANCH','RAILWAY_GIT_COMMIT_SHA',
]) {
  test('bootstrap fails closed on ' + key, () => {
    const env = fixture();
    env[key] = 'incorrect';
    assert.throws(() => exactBootstrapAuthorization(env),
      new RegExp('ATLAS_BOOTSTRAP_DENY ' + key));
  });
}

test('rejects malformed release SHA even when repository matches', () => {
  const env = fixture();
  env.ATLAS_BOOTSTRAP_RELEASE_SHA = 'not-a-commit';
  assert.throws(() => exactBootstrapAuthorization(env),
    /ATLAS_BOOTSTRAP_DENY invalid_allowed_sha/);
});

test('rejects unauthorized service and cross-service impersonation', () => {
  const invalid = fixture(); invalid.ATLAS_DEPLOYMENT_SERVICE = 'browser-worker';
  assert.throws(() => exactBootstrapAuthorization(invalid), /unsupported_service/);
  const swapped = fixture('engineering-runner');
  swapped.RAILWAY_SERVICE_ID = fixture('api').RAILWAY_SERVICE_ID;
  assert.throws(() => exactBootstrapAuthorization(swapped),
    /ATLAS_BOOTSTRAP_DENY RAILWAY_SERVICE_ID/);
});

test('release SHA mismatch may not fall back to ordinary gate', async () => {
  const env = fixture();
  env.RAILWAY_GIT_COMMIT_SHA = 'b'.repeat(40);
  let gates = 0; let migrations = 0;
  await assert.rejects(runPreDeploy({
    env,
    checkGate: async () => { gates++; },
    migrate: () => { migrations++; },
  }), /ATLAS_BOOTSTRAP_DENY RAILWAY_GIT_COMMIT_SHA/);
  assert.equal(gates, 0); assert.equal(migrations, 0);
});
