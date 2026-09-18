import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const dockerfilePath = path.resolve(__dirname, "..", "Dockerfile");

test("browser-worker keeps a PID 1 child reaper for Chromium", () => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /^\s*tini\s*\\?\s*$/m,
    "Dockerfile must install tini so orphaned Chromium children can be reaped.",
  );

  assert.match(
    dockerfile,
    /ENTRYPOINT \["\/usr\/bin\/tini", "-g", "--", "\/app\/apps\/browser-worker\/docker-entrypoint\.sh"\]/,
    "tini must remain PID 1 and forward signals to the browser-worker process group.",
  );
});
