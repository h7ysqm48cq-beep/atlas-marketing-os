import test from "node:test";
import assert from "node:assert/strict";

import {
  runSupervisorAdmission,
  type SupervisorTaskInput,
} from "../src/components/engineering/SupervisorOwnerPanel";

type RequestCall = {
  url: string;
  init: RequestInit | undefined;
};

function taskInput(): SupervisorTaskInput {
  return {
    objective: "Verify the exact candidate independently.",
    owner: "qa",
    allowedPaths: ["apps/web/src/components/engineering/SupervisorOwnerPanel.tsx"],
    forbiddenActions: ["merge", "deploy_production"],
    dependsOn: [],
    acceptance: ["Independent verification evidence is complete."],
  };
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function fakeFetch(calls: RequestCall[]) {
  let requestNumber = 0;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    requestNumber += 1;

    if (requestNumber === 1) {
      return response({ id: "ATLAS-TASK-1" });
    }
    if (requestNumber === 2) {
      return response({ id: "ATLAS-TASK-1", status: "WORKING" });
    }
    return response({
      execution: { id: "ATLAS-EXEC-1", status: "DISPATCHED" },
    });
  };
}

test("dispatches independent verification with explicit STANDARD eligibility", async () => {
  const calls: RequestCall[] = [];

  await runSupervisorAdmission(
    taskInput(),
    fakeFetch(calls),
    {
      executionPurpose: "INDEPENDENT_VERIFICATION",
      runnerEligibility: "STANDARD",
    },
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[2].url,
    "/api/atlas/engineering/supervisor/tasks/ATLAS-TASK-1/dispatch",
  );
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    executionPurpose: "INDEPENDENT_VERIFICATION",
    runnerEligibility: "STANDARD",
  });
  assert.equal(calls[2].init?.credentials, "same-origin");
  assert.deepEqual(calls[2].init?.headers, {
    "content-type": "application/json",
    "x-atlas-supervisor-owner-action": "1",
  });
});

test("keeps the existing implementation dispatch payload compatible", async () => {
  const calls: RequestCall[] = [];

  await runSupervisorAdmission(taskInput(), fakeFetch(calls));

  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {});
});

test("rejects independent verification with A1 synthetic before any request", async () => {
  const calls: RequestCall[] = [];

  await assert.rejects(
    runSupervisorAdmission(
      taskInput(),
      fakeFetch(calls),
      {
        executionPurpose: "INDEPENDENT_VERIFICATION",
        runnerEligibility: "A1_SYNTHETIC",
      },
    ),
    /INDEPENDENT_VERIFICATION requires STANDARD eligibility/,
  );

  assert.deepEqual(calls, []);
});
