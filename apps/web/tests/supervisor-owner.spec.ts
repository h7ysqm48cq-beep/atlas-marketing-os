import assert from "node:assert/strict";

import {
  authorizeEligibleBrowserWorkerDeployment,
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
            evidence: { reviewCandidate: candidate },
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
}

void main();

