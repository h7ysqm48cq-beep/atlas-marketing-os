import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("forces Chromium headless on Linux when no display server is available", async () => {
  const source = await readFile(
    path.resolve(__dirname, "index.ts"),
    "utf8",
  );

  assert.match(
    source,
    /const effectiveHeadless\s*=\s*resolveEffectiveHeadless\(/,
    "browser launch must resolve an environment-safe effective headless mode",
  );
  assert.match(
    source,
    /process\.platform[\s\S]*?linux[\s\S]*?DISPLAY[\s\S]*?WAYLAND_DISPLAY/,
    "Linux without DISPLAY or WAYLAND_DISPLAY must be detected before Chromium launch",
  );
  assert.match(
    source,
    /headless:\s*effectiveHeadless/,
    "launchPersistentContext must use the resolved effective headless mode",
  );
});