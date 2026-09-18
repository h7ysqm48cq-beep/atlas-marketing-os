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
