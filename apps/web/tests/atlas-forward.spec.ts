import assert from "node:assert/strict";
import test from "node:test";

import {
  getForwardAuthorization,
  isSupervisorWorkerPath,
  WORKER_CAPABILITY_HEADER,
} from "../src/app/api/atlas/forward";

test("recognizes only the dedicated Supervisor Worker route prefix", () => {
  assert.equal(
    isSupervisorWorkerPath(["engineering", "supervisor", "worker"]),
    true,
  );
  assert.equal(
    isSupervisorWorkerPath([
      "engineering",
      "supervisor",
      "worker",
      "tasks",
    ]),
    true,
  );
  assert.equal(
    isSupervisorWorkerPath(["engineering", "supervisor", "tasks"]),
    false,
  );
  assert.equal(
    isSupervisorWorkerPath(["engineering", "supervisor", "workerish"]),
    false,
  );
});

test("uses the dedicated capability for Worker routes and session auth elsewhere", () => {
  assert.equal(WORKER_CAPABILITY_HEADER, "x-atlas-worker-capability");
  assert.deepEqual(
    getForwardAuthorization({
      path: ["engineering", "supervisor", "worker", "tasks"],
      workerCapability: "capability-token",
      sessionAccessToken: "supabase-token",
    }),
    { authorization: "Bearer capability-token" },
  );
  assert.deepEqual(
    getForwardAuthorization({
      path: ["calendar"],
      workerCapability: "capability-token",
      sessionAccessToken: "supabase-token",
    }),
    { authorization: "Bearer supabase-token" },
  );
});

test("rejects missing Worker credentials without weakening ordinary auth", () => {
  assert.deepEqual(
    getForwardAuthorization({
      path: ["engineering", "supervisor", "worker", "tasks"],
      workerCapability: "",
      sessionAccessToken: "supabase-token",
    }),
    { error: "worker_capability_required" },
  );
  assert.deepEqual(
    getForwardAuthorization({
      path: ["calendar"],
      workerCapability: "",
      sessionAccessToken: "",
    }),
    { error: "session_required" },
  );
});
