import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local TCP port."));
        return;
      }

      const { port } = address;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForHttpResponse(
  url: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for ${url}`);
}

test("GET / is a public 200 health fallback", async () => {
  const workerPort = await reservePort();
  const viewerPort = await reservePort();
  const viewerInternalPort = await reservePort();
  const indexPath = path.resolve(__dirname, "index.ts");
  let stderr = "";

  const child = spawn(
    process.execPath,
    ["--import", "tsx", indexPath],
    {
      env: {
        ...process.env,
        PORT: String(workerPort),
        BROWSER_WORKER_PORT: String(workerPort),
        NOVNC_PORT: String(viewerPort),
        NOVNC_INTERNAL_PORT: String(viewerInternalPort),
        BROWSER_VIEWER_TOKEN_SECRET: "root-health-test-secret",
        BROWSER_WORKER_TOKEN: "root-health-worker-token",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const response = await waitForHttpResponse(
      `http://127.0.0.1:${workerPort}/`,
    );

    assert.equal(
      response.status,
      200,
      `expected GET / to bypass worker auth; stderr=${stderr}`,
    );

    assert.deepEqual(await response.json(), {
      ok: true,
      service: "atlas-browser-worker",
    });
  } finally {
    child.kill("SIGTERM");
  }
});
