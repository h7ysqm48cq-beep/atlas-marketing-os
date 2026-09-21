import test from "node:test";
import assert from "node:assert/strict";

import { loadEngineeringRunnerConfig } from "./config.ts";

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ATLAS_SUPERVISOR_API_URL: "https://example.invalid",
    ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN: "bootstrap",
    ATLAS_ENGINEERING_RUNNER_COMMAND: "python3",
    ATLAS_ENGINEERING_RUNNER_ARGS: "[]",
    ATLAS_ENGINEERING_RUNNER_WORKSPACE: "/legacy/workspace",
  };
}

test("candidate publication config is optional when all candidate keys are absent", () => {
  const config = loadEngineeringRunnerConfig(baseEnv()) as any;
  assert.equal(config.candidate, undefined);
});

test("candidate publication config loads with anonymous canonical source access", () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = "/workspaces";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
    "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";
  env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN = "publisher-token";
  const config = loadEngineeringRunnerConfig(env) as any;
  assert.deepEqual(config.candidate, {
    repositoryRoot: "/repo",
    workspaceRoot: "/workspaces",
    remote: "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git",
    publisherToken: "publisher-token",
  });
});

test("candidate publication config supports SSH deploy-key publisher auth", () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = "/workspaces";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
    "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";
  env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_SSH_PRIVATE_KEY =
    "-----BEGIN OPENSSH PRIVATE KEY-----\ndummy\n-----END OPENSSH PRIVATE KEY-----";
  const config = loadEngineeringRunnerConfig(env) as any;
  assert.equal(config.candidate.publisherToken, undefined);
  assert.match(
    config.candidate.publisherSshPrivateKey,
    /^-----BEGIN OPENSSH PRIVATE KEY-----/,
  );
});

test("candidate publication config supports persistent SSH publisher key path", () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = "/workspaces";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
    "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";
  env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_SSH_PRIVATE_KEY_PATH =
    "/data/publisher/id_ed25519";
  const config = loadEngineeringRunnerConfig(env) as any;
  assert.equal(config.candidate.publisherToken, undefined);
  assert.equal(config.candidate.publisherSshPrivateKey, undefined);
  assert.equal(
    config.candidate.publisherSshPrivateKeyPath,
    "/data/publisher/id_ed25519",
  );
});

test("candidate publication config rejects missing or ambiguous publisher auth", () => {
  const base = baseEnv();
  base.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
  base.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = "/workspaces";
  base.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
    "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";

  assert.throws(
    () => loadEngineeringRunnerConfig(base),
    /runner_candidate_publisher_auth_invalid/,
  );

  assert.throws(
    () =>
      loadEngineeringRunnerConfig({
        ...base,
        ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN: "publisher-token",
        ATLAS_ENGINEERING_RUNNER_PUBLISHER_SSH_PRIVATE_KEY:
          "-----BEGIN OPENSSH PRIVATE KEY-----\ndummy\n-----END OPENSSH PRIVATE KEY-----",
      }),
    /runner_candidate_publisher_auth_invalid/,
  );

  assert.throws(
    () =>
      loadEngineeringRunnerConfig({
        ...base,
        ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN: "publisher-token",
        ATLAS_ENGINEERING_RUNNER_PUBLISHER_SSH_PRIVATE_KEY_PATH:
          "/data/publisher/id_ed25519",
      }),
    /runner_candidate_publisher_auth_invalid/,
  );
});

test("candidate publication config fails closed when only some candidate keys are present", () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
  assert.throws(
    () => loadEngineeringRunnerConfig(env),
    /runner_candidate_config_incomplete/,
  );
});

test("candidate publication config requires distinct bootstrap, source, and publisher credentials", () => {
  for (const [bootstrapToken, sourceToken, publisherToken] of [
    ["bootstrap", "same-token", "same-token"],
    ["bootstrap", "bootstrap", "publisher-token"],
    ["bootstrap", "source-token", "bootstrap"],
  ]) {
    const env = baseEnv();
    env.ATLAS_SUPERVISOR_WORKER_BOOTSTRAP_TOKEN = bootstrapToken;
    env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
    env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = "/workspaces";
    env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
      "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";
    env.ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN = sourceToken;
    env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN = publisherToken;

    assert.throws(
      () => loadEngineeringRunnerConfig(env),
      /runner_candidate_credentials_not_separated/,
    );
  }
});

test("candidate publication config rejects any non-canonical network remote", () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = "/repo";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = "/workspaces";
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
    "https://github.com/example/other.git";
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_TOKEN = "source-token";
  env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN = "publisher-token";
  assert.throws(
    () => loadEngineeringRunnerConfig(env),
    /runner_candidate_remote_not_canonical/,
  );
});

test('signed mode uses ACTOR-specific token, never the legacy shared bootstrap', () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SIGNED_MODE = 'required';
  env.ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN = 'actor-token-unique';
  env.ATLAS_ENGINEERING_RUNNER_SIGNING_KID = 'independent-actor-kid';
  env.ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY =
    'LOCAL_PRIVATE_KEY_TEST_ONLY';
  env.ATLAS_ENGINEERING_RUNNER_PURPOSE = 'IMPLEMENTATION';
  env.ATLAS_ENGINEERING_RUNNER_SOURCE_REPOSITORY = '/repo';
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_WORKSPACE_ROOT = '/workspaces';
  env.ATLAS_ENGINEERING_RUNNER_CANDIDATE_REMOTE =
    'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git';
  env.ATLAS_ENGINEERING_RUNNER_PUBLISHER_TOKEN = 'publisher-token';
  const config = loadEngineeringRunnerConfig(env);
  assert.equal(config.bootstrapToken, 'actor-token-unique');
  assert.equal(config.signed?.kid, 'independent-actor-kid');
  assert.equal(config.signed?.purpose, 'IMPLEMENTATION');
});
test('signed mode missing actor token, kid, key or purpose fails before runner starts', () => {
  const complete = {
    ...baseEnv(),
    ATLAS_ENGINEERING_RUNNER_SIGNED_MODE: 'required',
    ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN: 'actor-token',
    ATLAS_ENGINEERING_RUNNER_SIGNING_KID: 'kid',
    ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY: 'KEY_ONLY_FOR_TEST',
    ATLAS_ENGINEERING_RUNNER_PURPOSE: 'INDEPENDENT_VERIFICATION',
  };
  for (const key of [
    'ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN',
    'ATLAS_ENGINEERING_RUNNER_SIGNING_KID',
    'ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY',
    'ATLAS_ENGINEERING_RUNNER_PURPOSE',
  ]) {
    const missing = { ...complete };
    delete (missing as Record<string, unknown>)[key];
    assert.throws(() => loadEngineeringRunnerConfig(missing),
      /runner_config_required:/);
  }
  assert.throws(() => loadEngineeringRunnerConfig({
    ...complete, ATLAS_ENGINEERING_RUNNER_PURPOSE: 'ADMIN',
  }), /runner_signed_purpose_invalid/);
});
test('partial signing secrets without explicit signed mode fail closed', () => {
  assert.throws(() => loadEngineeringRunnerConfig({
    ...baseEnv(),
    ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY: 'ACCIDENTAL_KEY',
  }), /runner_signed_mode_required_for_signer/);
});

test('signed verifier needs separate source-only checkout config, no publisher', () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SIGNED_MODE = 'required';
  env.ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN = 'actor-verifier-token';
  env.ATLAS_ENGINEERING_RUNNER_SIGNING_KID = 'verifier-kid';
  env.ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY = 'KEY_ONLY_LOCAL_TEST';
  env.ATLAS_ENGINEERING_RUNNER_PURPOSE = 'INDEPENDENT_VERIFICATION';
  assert.throws(() => loadEngineeringRunnerConfig(env),
    /runner_signed_verifier_source_invalid/);
  env.ATLAS_ENGINEERING_RUNNER_VERIFIER_SOURCE_REPOSITORY = '/bare/repo';
  env.ATLAS_ENGINEERING_RUNNER_VERIFIER_WORKSPACE_ROOT = '/isolated/verifier';
  env.ATLAS_ENGINEERING_RUNNER_VERIFIER_REMOTE =
    'https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git';
  env.ATLAS_ENGINEERING_RUNNER_VERIFIER_SOURCE_TOKEN = 'source-read-only';
  const loaded = loadEngineeringRunnerConfig(env);
  assert.equal(loaded.verifierSource?.repositoryRoot, '/bare/repo');
  assert.equal(loaded.verifierSource?.sourceToken, 'source-read-only');
  assert.equal(loaded.candidate, undefined);
  assert.throws(() => loadEngineeringRunnerConfig({
    ...env, ATLAS_ENGINEERING_RUNNER_VERIFIER_REMOTE:
      'https://github.com/other/other.git',
  }), /runner_signed_verifier_source_invalid/);
  assert.throws(() => loadEngineeringRunnerConfig({
    ...env, ATLAS_ENGINEERING_RUNNER_VERIFIER_SOURCE_TOKEN:
      'actor-verifier-token',
  }), /runner_signed_verifier_source_invalid/);
});
test('signed implementer cannot claim before candidate publishing configured', () => {
  const env = baseEnv();
  env.ATLAS_ENGINEERING_RUNNER_SIGNED_MODE = 'required';
  env.ATLAS_ENGINEERING_RUNNER_SIGNED_BOOTSTRAP_TOKEN = 'actor-token';
  env.ATLAS_ENGINEERING_RUNNER_SIGNING_KID = 'implementer-kid';
  env.ATLAS_ENGINEERING_RUNNER_SIGNING_PRIVATE_KEY = 'LOCAL_ONLY';
  env.ATLAS_ENGINEERING_RUNNER_PURPOSE = 'IMPLEMENTATION';
  assert.throws(() => loadEngineeringRunnerConfig(env),
    /runner_signed_implementation_candidate_required/);
});
