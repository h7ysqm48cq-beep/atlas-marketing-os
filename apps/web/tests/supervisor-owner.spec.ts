import assert from "node:assert/strict";

import {
  approveAndAuthorizeExistingMerge,
  authorizeEligibleBrowserWorkerDeployment,
  authorizeEligibleWebDeployment,
  authorizeEligibleWorkerDeployment,
  loadExistingMergeReview,
  recoverStaleBrowserWorkerTask,
  getSupervisorStatus,
  runSupervisorAdmission,
} from "../src/components/engineering/SupervisorOwnerPanel";
import type { SupervisorTaskInput } from "../src/components/engineering/SupervisorOwnerPanel";

const input: SupervisorTaskInput = {
  objective: "repair the admission flow",
  owner: "frontend" as const,
  allowedPaths: ["apps/web/src/components/engineering/SupervisorOwnerPanel.tsx"],
  forbiddenActions: ["deploy_production"],
  dependsOn: [],
  acceptance: ["refresh reads persisted status"],
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function main() {
  const calls: string[] = [];
  let partialError: unknown;

  try {
    await runSupervisorAdmission(input, async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/tasks")) {
        return response(201, { id: "task-1" });
      }
      return response(409, { code: "file_ownership_conflict" });
    });
  } catch (error) {
    partialError = error;
  }

  assert.deepEqual(calls, [
    "POST /api/atlas/engineering/supervisor/tasks",
    "POST /api/atlas/engineering/supervisor/tasks/task-1/start",
  ]);
  assert.deepEqual((partialError as { partialResult: unknown }).partialResult, {
    taskId: "task-1",
    taskStatus: "CREATED",
    executionId: null,
    executionStatus: null,
  });

  const frozenBaseSha = "A".repeat(40);
  const admissionCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  const queuedAdmission = await runSupervisorAdmission(
    input,
    async (url, init) => {
      admissionCalls.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (String(url).endsWith("/tasks")) {
        return response(201, { id: "task-queued" });
      }
      if (String(url).endsWith("/start")) {
        return response(200, { id: "task-queued", status: "WORKING" });
      }
      return response(200, {
        execution: {
          id: "execution-queued",
          status: "QUEUED",
        },
      });
    },
    { frozenBaseSha },
  );

  assert.deepEqual(queuedAdmission, {
    taskId: "task-queued",
    taskStatus: "WORKING",
    executionId: "execution-queued",
    executionStatus: "QUEUED",
  });
  assert.deepEqual(admissionCalls, [
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks",
      body: JSON.stringify(input),
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/task-queued/start",
      body: "{}",
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/task-queued/dispatch",
      body: JSON.stringify({
        frozenBaseSha: frozenBaseSha.toLowerCase(),
      }),
    },
  ]);

  let invalidFrozenBaseError: unknown;
  try {
    await runSupervisorAdmission(
      input,
      async () => {
        throw new Error("network must not be called");
      },
      { frozenBaseSha: "not-a-sha" },
    );
  } catch (error) {
    invalidFrozenBaseError = error;
  }
  assert.match(
    (invalidFrozenBaseError as Error).message,
    /Frozen base SHA must be exactly 40 hexadecimal characters/,
  );

  const statusCalls: string[] = [];
  const status = await getSupervisorStatus("task-1", null, async (url, init) => {
    statusCalls.push(`${init?.method ?? "GET"} ${String(url)}`);
    if (String(url).endsWith("/executions")) {
      return response(200, []);
    }

    return response(200, { id: "task-1", status: "WORKING" });
  });

  assert.deepEqual(statusCalls, [
    "GET /api/atlas/engineering/supervisor/tasks/task-1",
    "GET /api/atlas/engineering/supervisor/tasks/task-1/executions",
  ]);
  assert.deepEqual(status, {
    taskId: "task-1",
    taskStatus: "WORKING",
    executionId: null,
    executionStatus: null,
  });

  const executionStatus = await getSupervisorStatus(
    "task-1",
    "execution-1",
    async (url, init) => {
      assert.equal(init?.method, "GET");
      return String(url).endsWith("/executions/execution-1")
        ? response(200, { id: "execution-1", status: "RUNNING" })
        : response(200, { id: "task-1", status: "WORKING" });
    },
  );

  assert.deepEqual(executionStatus, {
    taskId: "task-1",
    taskStatus: "WORKING",
    executionId: "execution-1",
    executionStatus: "RUNNING",
  });

  const recoveryCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  const recovered = await recoverStaleBrowserWorkerTask(async (url, init) => {
    recoveryCalls.push({
      method: init?.method ?? "GET",
      url: String(url),
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (init?.method === "GET") {
      return response(200, [
        {
          id: "stale-browser-worker-task",
          status: "WORKING",
          objective: "Railway browser-worker production deployment",
          allowedPaths: ["apps/browser-worker/**"],
        },
      ]);
    }

    return response(200, {
      id: "stale-browser-worker-task",
      status: "FAILED",
    });
  });

  assert.deepEqual(recoveryCalls, [
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/stale-browser-worker-task/fail",
      body: JSON.stringify({
        reason:
          "Release stale browser-worker production deployment ownership before resuming the authorized deployment flow.",
      }),
    },
  ]);
  assert.deepEqual(recovered, {
    taskId: "stale-browser-worker-task",
    taskStatus: "FAILED",
    executionId: null,
    executionStatus: null,
  });

  const candidate = {
    action: "deploy_production",
    targetBranch: "production/atlas",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    changedFiles: ["apps/browser-worker/src/index.ts"],
  };
  const authorizationCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  const authorized =
    await authorizeEligibleBrowserWorkerDeployment(async (url, init) => {
      authorizationCalls.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (String(url).endsWith("/tasks")) {
        return response(200, [
          {
            id: "browser-worker-deploy-task",
            status: "APPROVED",
            objective: "Authorize Browser Worker production deployment",
            evidence: { reviewCandidate: candidate },
          },
        ]);
      }

      if (String(url).endsWith("/tasks/browser-worker-deploy-task/executions")) {
        return response(200, [
          {
            id: "browser-worker-deploy-execution",
            status: "COMPLETED",
            result: {
              evidence: { reviewCandidate: candidate },
            },
          },
        ]);
      }

      return response(201, { status: "APPROVED" });
    });

  assert.deepEqual(authorizationCalls, [
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks",
      body: undefined,
    },
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-deploy-task/executions",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-deploy-task/authorize-production-deployment",
      body: JSON.stringify({
        candidate,
        service: "browser-worker",
      }),
    },
  ]);
  assert.deepEqual(authorized, {
    taskId: "browser-worker-deploy-task",
    taskStatus: "APPROVED",
    executionId: "browser-worker-deploy-execution",
    executionStatus: "COMPLETED",
  });
  const selectedCandidate = {
    action: "deploy_production",
    targetBranch: "production/atlas",
    baseSha: "c".repeat(40),
    headSha: "d".repeat(40),
    changedFiles: ["apps/browser-worker/src/index.ts"],
  };
  const selectedCalls: string[] = [];
  const selected =
    await authorizeEligibleBrowserWorkerDeployment(
      async (url, init) => {
        selectedCalls.push(
          (init?.method ?? "GET") + " " + String(url),
        );

        if (String(url).endsWith("/tasks")) {
          return response(200, [
            {
              id: "historical-browser-worker-task",
              status: "APPROVED",
              evidence: { reviewCandidate: candidate },
            },
            {
              id: "current-browser-worker-task",
              status: "APPROVED",
              evidence: { reviewCandidate: selectedCandidate },
            },
          ]);
        }

        if (
          String(url).endsWith(
            "/tasks/current-browser-worker-task/executions",
          )
        ) {
          return response(200, [
            {
              id: "current-browser-worker-execution",
              status: "COMPLETED",
              result: {
                evidence: { reviewCandidate: selectedCandidate },
              },
            },
          ]);
        }

        return response(201, { status: "APPROVED" });
      },
      " current-browser-worker-task ",
    );

  assert.deepEqual(selected, {
    taskId: "current-browser-worker-task",
    taskStatus: "APPROVED",
    executionId: "current-browser-worker-execution",
    executionStatus: "COMPLETED",
  });
  assert.deepEqual(selectedCalls, [
    "GET /api/atlas/engineering/supervisor/tasks",
    "GET /api/atlas/engineering/supervisor/tasks/current-browser-worker-task/executions",
    "POST /api/atlas/engineering/supervisor/tasks/current-browser-worker-task/authorize-production-deployment",
  ]);

  await assert.rejects(
    () =>
      authorizeEligibleBrowserWorkerDeployment(
        async (url) => {
          if (String(url).endsWith("/tasks")) {
            return response(200, [
              {
                id: "historical-browser-worker-task",
                status: "APPROVED",
                evidence: { reviewCandidate: candidate },
              },
            ]);
          }
          throw new Error("unexpected request");
        },
        "missing-browser-worker-task",
      ),
    /No approved browser-worker production deployment candidate was found for task missing-browser-worker-task/,
  );

  await assert.rejects(
    () =>
      authorizeEligibleBrowserWorkerDeployment(
        async (url) => {
          if (String(url).endsWith("/tasks")) {
            return response(200, [
              {
                id: "browser-worker-task-a",
                status: "APPROVED",
                evidence: { reviewCandidate: candidate },
              },
              {
                id: "browser-worker-task-b",
                status: "APPROVED",
                evidence: { reviewCandidate: selectedCandidate },
              },
            ]);
          }
          throw new Error("unexpected request");
        },
      ),
    /More than one approved browser-worker production deployment candidate was found/,
  );

  await assert.rejects(
    () =>
      authorizeEligibleBrowserWorkerDeployment(
        async (url) => {
          if (String(url).endsWith("/tasks")) {
            return response(200, [
              {
                id: "browser-worker-top-level-evidence-only",
                status: "APPROVED",
                evidence: { reviewCandidate: candidate },
              },
            ]);
          }

          if (
            String(url).endsWith(
              "/tasks/browser-worker-top-level-evidence-only/executions",
            )
          ) {
            return response(200, [
              {
                id: "top-level-evidence-only-execution",
                status: "COMPLETED",
                evidence: { reviewCandidate: candidate },
              },
            ]);
          }

          throw new Error("unexpected request");
        },
        "browser-worker-top-level-evidence-only",
      ),
    /The approved browser-worker candidate has no matching completed execution/,
  );

  const webCandidate = {
    action: "deploy_production",
    targetBranch: "production/atlas",
    baseSha: "e".repeat(40),
    headSha: "f".repeat(40),
    changedFiles: [
      "apps/web/src/components/engineering/SupervisorOwnerPanel.tsx",
    ],
  };
  const webAuthorizationCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  const webAuthorized =
    await authorizeEligibleWebDeployment(
      async (url, init) => {
        webAuthorizationCalls.push({
          method: init?.method ?? "GET",
          url: String(url),
          body:
            typeof init?.body === "string"
              ? init.body
              : undefined,
        });

        if (String(url).endsWith("/tasks")) {
          return response(200, [
            {
              id: "web-deploy-task",
              status: "APPROVED",
              evidence: { reviewCandidate: webCandidate },
            },
          ]);
        }

        if (
          String(url).endsWith(
            "/tasks/web-deploy-task/executions",
          )
        ) {
          return response(200, [
            {
              id: "web-deploy-execution",
              status: "COMPLETED",
              result: {
                evidence: { reviewCandidate: webCandidate },
              },
            },
          ]);
        }

        return response(201, { status: "APPROVED" });
      },
      " web-deploy-task ",
    );

  assert.deepEqual(webAuthorized, {
    taskId: "web-deploy-task",
    taskStatus: "APPROVED",
    executionId: "web-deploy-execution",
    executionStatus: "COMPLETED",
  });
  assert.deepEqual(webAuthorizationCalls, [
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks",
      body: undefined,
    },
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/web-deploy-task/executions",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/web-deploy-task/authorize-production-deployment",
      body: JSON.stringify({
        candidate: webCandidate,
        service: "web",
      }),
    },
  ]);

  await assert.rejects(
    () =>
      authorizeEligibleWebDeployment(
        async (url) => {
          if (String(url).endsWith("/tasks")) {
            return response(200, [
              {
                id: "web-invalid-path-task",
                status: "APPROVED",
                evidence: {
                  reviewCandidate: {
                    ...webCandidate,
                    changedFiles: [
                      "apps/browser-worker/src/index.ts",
                    ],
                  },
                },
              },
            ]);
          }
          throw new Error("unexpected request");
        },
        "web-invalid-path-task",
      ),
    /No approved web production deployment candidate was found for task web-invalid-path-task/,
  );


  const browserWorkerSha = "8".repeat(40);
  const browserWorkerCandidate = {
    action: "deploy_production",
    targetBranch: "production/atlas",
    baseSha: browserWorkerSha,
    headSha: browserWorkerSha,
    changedFiles: [],
  };
  const browserWorkerCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  let browserWorkerTaskReadCount = 0;
  const browserWorkerAuthorized =
    await authorizeEligibleWorkerDeployment(
      async (url, init) => {
        browserWorkerCalls.push({
          method: init?.method ?? "GET",
          url: String(url),
          body:
            typeof init?.body === "string"
              ? init.body
              : undefined,
        });

        if (
          String(url).endsWith(
            "/tasks/browser-worker-same-sha-task",
          )
        ) {
          browserWorkerTaskReadCount += 1;
          return response(200, {
            id: "browser-worker-same-sha-task",
            status:
              browserWorkerTaskReadCount === 1
                ? "READY_FOR_REVIEW"
                : "APPROVED",
            allowedPaths: ["apps/browser-worker/railway.json"],
            acceptance: [
              `baseSha=headSha=${browserWorkerSha}`,
              "service=browser-worker",
              "zero git diff",
              "sourceVerified=true",
              "candidatePublication absent",
            ],
            evidence: {
              deploymentState: "NOT_DEPLOYED",
              reviewCandidate: browserWorkerCandidate,
              existingCandidateVerification: {
                mode: "EXISTING_CANDIDATE",
                taskId: "browser-worker-same-sha-task",
                executionId: "browser-worker-same-sha-execution",
                baseSha: browserWorkerSha,
                headSha: browserWorkerSha,
                productionBaselineSha: browserWorkerSha,
                targetBranch: "production/atlas",
                changedFiles: [],
                sourceVerified: true,
              },
            },
          });
        }

        if (
          String(url).endsWith(
            "/tasks/browser-worker-same-sha-task/approve",
          )
        ) {
          return response(201, {
            id: "browser-worker-same-sha-task",
            status: "APPROVED",
          });
        }

        if (
          String(url).endsWith(
            "/tasks/browser-worker-same-sha-task/executions",
          )
        ) {
          return response(200, [
            {
              id: "browser-worker-same-sha-execution",
              status: "COMPLETED",
              assignment: {
                executionPurpose: "INDEPENDENT_VERIFICATION",
                verificationMode: "EXISTING_CANDIDATE",
              },
              result: {
                evidence: {
                  reviewCandidate: browserWorkerCandidate,
                  existingCandidateVerification: {
                    mode: "EXISTING_CANDIDATE",
                    taskId: "browser-worker-same-sha-task",
                    executionId: "browser-worker-same-sha-execution",
                    baseSha: browserWorkerSha,
                    headSha: browserWorkerSha,
                    productionBaselineSha: browserWorkerSha,
                    targetBranch: "production/atlas",
                    changedFiles: [],
                    sourceVerified: true,
                  },
                },
              },
            },
          ]);
        }

        return response(201, {
          id: "browser-worker-same-sha-task",
          status: "APPROVED",
          evidence: {
            deploymentState: "NOT_DEPLOYED",
            ownerDeploymentAuthorization: {
              service: "browser-worker",
              candidate: browserWorkerCandidate,
              signature: "signed-browser-worker-authorization",
            },
          },
        });
      },
      "browser-worker",
      " browser-worker-same-sha-task ",
    );

  assert.deepEqual(browserWorkerAuthorized, {
    taskId: "browser-worker-same-sha-task",
    taskStatus: "APPROVED",
    executionId: "browser-worker-same-sha-execution",
    executionStatus: "COMPLETED",
  });
  assert.deepEqual(browserWorkerCalls, [
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-same-sha-task",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-same-sha-task/approve",
      body: JSON.stringify({}),
    },
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-same-sha-task",
      body: undefined,
    },
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-same-sha-task/executions",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/browser-worker-same-sha-task/authorize-production-deployment",
      body: JSON.stringify({
        candidate: browserWorkerCandidate,
        service: "browser-worker",
      }),
    },
  ]);

  for (const invalid of [
    {
      name: "changed-files",
      allowedPaths: ["apps/browser-worker/railway.json"],
      sourceVerified: true,
      deploymentState: "NOT_DEPLOYED",
      changedFiles: ["apps/browser-worker/src/index.ts"],
      authorization: undefined,
      reservation: undefined,
      consumption: undefined,
    },
    {
      name: "wrong-path",
      allowedPaths: ["apps/browser-worker/src/index.ts"],
      sourceVerified: true,
      deploymentState: "NOT_DEPLOYED",
      changedFiles: [],
      authorization: undefined,
      reservation: undefined,
      consumption: undefined,
    },
    {
      name: "unverified",
      allowedPaths: ["apps/browser-worker/railway.json"],
      sourceVerified: false,
      deploymentState: "NOT_DEPLOYED",
      changedFiles: [],
      authorization: undefined,
      reservation: undefined,
      consumption: undefined,
    },
    {
      name: "authorized",
      allowedPaths: ["apps/browser-worker/railway.json"],
      sourceVerified: true,
      deploymentState: "NOT_DEPLOYED",
      changedFiles: [],
      authorization: {},
      reservation: undefined,
      consumption: undefined,
    },
    {
      name: "reserved",
      allowedPaths: ["apps/browser-worker/railway.json"],
      sourceVerified: true,
      deploymentState: "NOT_DEPLOYED",
      changedFiles: [],
      authorization: undefined,
      reservation: {},
      consumption: undefined,
    },
    {
      name: "consumed",
      allowedPaths: ["apps/browser-worker/railway.json"],
      sourceVerified: true,
      deploymentState: "DEPLOYMENT_AUTHORIZATION_CONSUMED",
      changedFiles: [],
      authorization: undefined,
      reservation: undefined,
      consumption: {},
    },
  ]) {
    await assert.rejects(
      () =>
        authorizeEligibleWorkerDeployment(
          async (url) => {
            if (
              String(url).endsWith(
                `/tasks/browser-worker-${invalid.name}`,
              )
            ) {
              return response(200, {
                id: `browser-worker-${invalid.name}`,
                status: "READY_FOR_REVIEW",
                allowedPaths: invalid.allowedPaths,
                acceptance: [
                  `baseSha=headSha=${browserWorkerSha}`,
                  "service=browser-worker",
                ],
                evidence: {
                  deploymentState: invalid.deploymentState,
                  reviewCandidate: {
                    ...browserWorkerCandidate,
                    changedFiles: invalid.changedFiles,
                  },
                  existingCandidateVerification: {
                    mode: "EXISTING_CANDIDATE",
                    taskId: `browser-worker-${invalid.name}`,
                    executionId: `browser-worker-${invalid.name}-execution`,
                    baseSha: browserWorkerSha,
                    headSha: browserWorkerSha,
                    productionBaselineSha: browserWorkerSha,
                    targetBranch: "production/atlas",
                    changedFiles: invalid.changedFiles,
                    sourceVerified: invalid.sourceVerified,
                  },
                  ownerDeploymentAuthorization:
                    invalid.authorization,
                  ownerDeploymentDispatchReservation:
                    invalid.reservation,
                  ownerDeploymentAuthorizationConsumption:
                    invalid.consumption,
                },
              });
            }
            throw new Error("unexpected request");
          },
          "browser-worker",
          `browser-worker-${invalid.name}`,
        ),
      /is not an eligible browser-worker same-SHA deployment candidate/,
    );
  }

  let toctouReadCount = 0;
  await assert.rejects(
    () =>
      authorizeEligibleWorkerDeployment(
        async (url) => {
          if (
            String(url).endsWith(
              "/tasks/browser-worker-toctou",
            )
          ) {
            toctouReadCount += 1;
            const headSha =
              toctouReadCount === 1
                ? browserWorkerSha
                : "7".repeat(40);
            return response(200, {
              id: "browser-worker-toctou",
              status:
                toctouReadCount === 1
                  ? "READY_FOR_REVIEW"
                  : "APPROVED",
              allowedPaths: ["apps/browser-worker/railway.json"],
              acceptance: [
                `baseSha=headSha=${headSha}`,
                "service=browser-worker",
              ],
              evidence: {
                deploymentState: "NOT_DEPLOYED",
                reviewCandidate: {
                  ...browserWorkerCandidate,
                  baseSha: headSha,
                  headSha,
                },
                existingCandidateVerification: {
                  mode: "EXISTING_CANDIDATE",
                  taskId: "browser-worker-toctou",
                  executionId: "browser-worker-toctou-execution",
                  baseSha: headSha,
                  headSha,
                  productionBaselineSha: headSha,
                  targetBranch: "production/atlas",
                  changedFiles: [],
                  sourceVerified: true,
                },
              },
            });
          }

          if (
            String(url).endsWith(
              "/tasks/browser-worker-toctou/approve",
            )
          ) {
            return response(201, {
              id: "browser-worker-toctou",
              status: "APPROVED",
            });
          }

          throw new Error("unexpected request");
        },
        "browser-worker",
        "browser-worker-toctou",
      ),
    /candidate changed after Owner approval/,
  );

  const runnerSha = "9".repeat(40);
  const runnerCandidate = {
    action: "deploy_production",
    targetBranch: "production/atlas",
    baseSha: runnerSha,
    headSha: runnerSha,
    changedFiles: [],
  };
  const workerAuthorizationCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  const runnerAuthorized =
    await authorizeEligibleWorkerDeployment(
      async (url, init) => {
        workerAuthorizationCalls.push({
          method: init?.method ?? "GET",
          url: String(url),
          body:
            typeof init?.body === "string"
              ? init.body
              : undefined,
        });

        if (
          String(url).endsWith(
            "/tasks/runner-deploy-task",
          )
        ) {
          return response(200, {
            id: "runner-deploy-task",
            status: "APPROVED",
            allowedPaths: [
              "apps/engineering-runner/check-runner-production-deployment.cjs",
            ],
            acceptance: [
              `baseSha=headSha=${runnerSha}`,
              "service=engineering-runner",
              "zero git diff",
              "sourceVerified=true",
              "candidatePublication absent",
            ],
            evidence: {
              deploymentState: "NOT_DEPLOYED",
              reviewCandidate: runnerCandidate,
              existingCandidateVerification: {
                mode: "EXISTING_CANDIDATE",
                taskId: "runner-deploy-task",
                executionId: "runner-deploy-execution",
                baseSha: runnerSha,
                headSha: runnerSha,
                productionBaselineSha: runnerSha,
                targetBranch: "production/atlas",
                changedFiles: [],
                sourceVerified: true,
              },
            },
          });
        }

        if (
          String(url).endsWith(
            "/tasks/runner-deploy-task/executions",
          )
        ) {
          return response(200, [
            {
              id: "runner-deploy-execution",
              status: "COMPLETED",
              assignment: {
                executionPurpose: "INDEPENDENT_VERIFICATION",
                verificationMode: "EXISTING_CANDIDATE",
              },
              result: {
                evidence: {
                  reviewCandidate: runnerCandidate,
                  existingCandidateVerification: {
                    mode: "EXISTING_CANDIDATE",
                    taskId: "runner-deploy-task",
                    executionId: "runner-deploy-execution",
                    baseSha: runnerSha,
                    headSha: runnerSha,
                    productionBaselineSha: runnerSha,
                    targetBranch: "production/atlas",
                    changedFiles: [],
                    sourceVerified: true,
                  },
                },
              },
            },
          ]);
        }

        return response(201, {
          id: "runner-deploy-task",
          status: "APPROVED",
          evidence: {
            deploymentState: "NOT_DEPLOYED",
            ownerDeploymentAuthorization: {
              service: "engineering-runner",
              candidate: runnerCandidate,
              signature: "signed-runner-authorization",
            },
          },
        });
      },
      "engineering-runner",
      " runner-deploy-task ",
    );

  assert.deepEqual(runnerAuthorized, {
    taskId: "runner-deploy-task",
    taskStatus: "APPROVED",
    executionId: "runner-deploy-execution",
    executionStatus: "COMPLETED",
  });
  assert.deepEqual(workerAuthorizationCalls, [
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/runner-deploy-task",
      body: undefined,
    },
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/runner-deploy-task/executions",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/runner-deploy-task/authorize-production-deployment",
      body: JSON.stringify({
        candidate: runnerCandidate,
        service: "engineering-runner",
      }),
    },
  ]);

  const verifierCandidate = {
    ...runnerCandidate,
  };
  const verifierAuthorized =
    await authorizeEligibleWorkerDeployment(
      async (url, init) => {
        if (
          String(url).endsWith(
            "/tasks/verifier-deploy-task",
          )
        ) {
          return response(200, {
            id: "verifier-deploy-task",
            status: "APPROVED",
            allowedPaths: [
              "apps/engineering-runner/check-verifier-production-deployment.cjs",
            ],
            acceptance: [
              `baseSha=headSha=${runnerSha}`,
              "service=engineering-verifier",
            ],
            evidence: {
              deploymentState: "NOT_DEPLOYED",
              reviewCandidate: verifierCandidate,
              existingCandidateVerification: {
                mode: "EXISTING_CANDIDATE",
                taskId: "verifier-deploy-task",
                executionId: "verifier-deploy-execution",
                baseSha: runnerSha,
                headSha: runnerSha,
                productionBaselineSha: runnerSha,
                targetBranch: "production/atlas",
                changedFiles: [],
                sourceVerified: true,
              },
            },
          });
        }

        if (
          String(url).endsWith(
            "/tasks/verifier-deploy-task/executions",
          )
        ) {
          return response(200, [
            {
              id: "verifier-deploy-execution",
              status: "COMPLETED",
              assignment: {
                executionPurpose: "INDEPENDENT_VERIFICATION",
                verificationMode: "EXISTING_CANDIDATE",
              },
              result: {
                evidence: {
                  reviewCandidate: verifierCandidate,
                  existingCandidateVerification: {
                    mode: "EXISTING_CANDIDATE",
                    taskId: "verifier-deploy-task",
                    executionId: "verifier-deploy-execution",
                    baseSha: runnerSha,
                    headSha: runnerSha,
                    productionBaselineSha: runnerSha,
                    targetBranch: "production/atlas",
                    changedFiles: [],
                    sourceVerified: true,
                  },
                },
              },
            },
          ]);
        }

        assert.equal(init?.method, "POST");
        return response(201, {
          id: "verifier-deploy-task",
          status: "APPROVED",
          evidence: {
            deploymentState: "NOT_DEPLOYED",
            ownerDeploymentAuthorization: {
              service: "engineering-verifier",
              candidate: verifierCandidate,
              signature: "signed-verifier-authorization",
            },
          },
        });
      },
      "engineering-verifier",
      "verifier-deploy-task",
    );

  assert.deepEqual(verifierAuthorized, {
    taskId: "verifier-deploy-task",
    taskStatus: "APPROVED",
    executionId: "verifier-deploy-execution",
    executionStatus: "COMPLETED",
  });

  await assert.rejects(
    () =>
      authorizeEligibleWorkerDeployment(
        async (url) => {
          if (
            String(url).endsWith(
              "/tasks/verifier-invalid-task",
            )
          ) {
            return response(200, {
              id: "verifier-invalid-task",
              status: "APPROVED",
              allowedPaths: [
                "apps/engineering-runner/check-verifier-production-deployment.cjs",
              ],
              acceptance: [
                `baseSha=headSha=${runnerSha}`,
                "service=engineering-verifier",
              ],
              evidence: {
                deploymentState: "NOT_DEPLOYED",
                reviewCandidate: {
                  ...runnerCandidate,
                  changedFiles: ["apps/api/src/main.ts"],
                },
                existingCandidateVerification: {
                  sourceVerified: true,
                },
              },
            });
          }
          throw new Error("unexpected request");
        },
        "engineering-verifier",
        "verifier-invalid-task",
      ),
    /is not an eligible engineering-verifier same-SHA deployment candidate/,
  );

  await assert.rejects(
    () =>
      authorizeEligibleWorkerDeployment(
        async (url) => {
          if (
            String(url).endsWith(
              "/tasks/runner-replay-task",
            )
          ) {
            return response(200, {
              id: "runner-replay-task",
              status: "APPROVED",
              allowedPaths: [
                "apps/engineering-runner/check-runner-production-deployment.cjs",
              ],
              acceptance: [
                `baseSha=headSha=${runnerSha}`,
                "service=engineering-runner",
              ],
              evidence: {
                deploymentState: "DEPLOYMENT_AUTHORIZATION_CONSUMED",
                reviewCandidate: runnerCandidate,
                existingCandidateVerification: {
                  sourceVerified: true,
                },
                ownerDeploymentAuthorizationConsumption: {},
              },
            });
          }
          throw new Error("unexpected request");
        },
        "engineering-runner",
        "runner-replay-task",
      ),
    /is not an eligible engineering-runner same-SHA deployment candidate/,
  );

  const mergeCandidate = {
    action: "merge" as const,
    targetBranch: "main" as const,
    baseSha: "1".repeat(40),
    headSha: "2".repeat(40),
    changedFiles: [
      "apps/api/src/notifications/notification.service.spec.ts",
    ],
  };

  const reviewCalls: string[] = [];
  const loadedReview = await loadExistingMergeReview(
    " review-task ",
    async (url, init) => {
      reviewCalls.push(
        (init?.method ?? "GET") + " " + String(url),
      );
      return response(200, {
        id: "review-task",
        status: "READY_FOR_REVIEW",
        evidence: {
          deploymentState: "NOT_DEPLOYED",
          existingCandidateVerification: {
            sourceVerified: true,
          },
          reviewCandidate: mergeCandidate,
        },
      });
    },
  );

  assert.deepEqual(reviewCalls, [
    "GET /api/atlas/engineering/supervisor/tasks/review-task",
  ]);
  assert.deepEqual(loadedReview, {
    taskId: "review-task",
    taskStatus: "READY_FOR_REVIEW",
    sourceVerified: true,
    deploymentState: "NOT_DEPLOYED",
    candidate: mergeCandidate,
    hasMergeAuthorization: false,
    hasMergeConsumption: false,
  });

  await assert.rejects(
    () =>
      loadExistingMergeReview(
        "unverified-task",
        async () =>
          response(200, {
            id: "unverified-task",
            status: "READY_FOR_REVIEW",
            evidence: {
              deploymentState: "NOT_DEPLOYED",
              existingCandidateVerification: {
                sourceVerified: false,
              },
              reviewCandidate: mergeCandidate,
            },
          }),
      ),
    /sourceVerified=true/,
  );

  const mergeAuthorizationCalls: Array<{
    method: string;
    url: string;
    body?: string;
  }> = [];
  const authorizedMerge = await approveAndAuthorizeExistingMerge(
    loadedReview,
    async (url, init) => {
      mergeAuthorizationCalls.push({
        method: init?.method ?? "GET",
        url: String(url),
        body:
          typeof init?.body === "string"
            ? init.body
            : undefined,
      });

      if ((init?.method ?? "GET") === "GET") {
        return response(200, {
          id: "review-task",
          status: "READY_FOR_REVIEW",
          evidence: {
            deploymentState: "NOT_DEPLOYED",
            existingCandidateVerification: {
              sourceVerified: true,
            },
            reviewCandidate: mergeCandidate,
          },
        });
      }

      if (String(url).endsWith("/approve")) {
        return response(201, {
          id: "review-task",
          status: "APPROVED",
          evidence: {
            deploymentState: "NOT_DEPLOYED",
            reviewCandidate: mergeCandidate,
          },
        });
      }

      return response(201, {
        id: "review-task",
        status: "APPROVED",
        evidence: {
          deploymentState: "NOT_DEPLOYED",
          reviewCandidate: mergeCandidate,
          ownerMergeAuthorization: {
            candidate: mergeCandidate,
            authorizedBy: "owner",
            authorizedAt: "2026-10-04T00:00:00.000Z",
            signature: "signed",
          },
        },
      });
    },
  );

  assert.deepEqual(mergeAuthorizationCalls, [
    {
      method: "GET",
      url: "/api/atlas/engineering/supervisor/tasks/review-task",
      body: undefined,
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/review-task/approve",
      body: "{}",
    },
    {
      method: "POST",
      url: "/api/atlas/engineering/supervisor/tasks/review-task/authorize-merge",
      body: JSON.stringify({ candidate: mergeCandidate }),
    },
  ]);
  assert.equal(authorizedMerge.taskStatus, "APPROVED");
  assert.equal(authorizedMerge.hasMergeAuthorization, true);
  assert.deepEqual(authorizedMerge.candidate, mergeCandidate);

  await assert.rejects(
    () =>
      approveAndAuthorizeExistingMerge(
        loadedReview,
        async () =>
          response(200, {
            id: "review-task",
            status: "READY_FOR_REVIEW",
            evidence: {
              deploymentState: "NOT_DEPLOYED",
              existingCandidateVerification: {
                sourceVerified: true,
              },
              reviewCandidate: {
                ...mergeCandidate,
                headSha: "3".repeat(40),
              },
            },
          }),
      ),
    /candidate changed since it was loaded/,
  );

}

void main();

