import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readWorkerSource() {
  return readFile(
    path.resolve(
      __dirname,
      "index.ts",
    ),
    "utf8",
  );
}

test("persistent Browser profile launch is bounded by a native Playwright timeout", async () => {
  const source =
    await readWorkerSource();

  assert.match(
    source,
    /const BROWSER_PROFILE_LAUNCH_TIMEOUT_MS =\s*30000;/,
  );

  assert.match(
    source,
    /const launchOptions = \{[\s\S]*?timeout:\s*BROWSER_PROFILE_LAUNCH_TIMEOUT_MS,/,
    "both initial and stale-lock recovery launches must inherit the bounded launch timeout",
  );
});

test("Browser profile opening guard is always released in finally", async () => {
  const source =
    await readWorkerSource();

  assert.match(
    source,
    /finally \{\s*openingProfiles\.delete\(\s*profileKey,?\s*\);\s*\}/,
    "timed-out profile opens must release openingProfiles",
  );
});
