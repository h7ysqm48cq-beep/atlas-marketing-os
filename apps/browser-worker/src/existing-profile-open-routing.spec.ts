import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function readExistingProfileBranch(source: string) {
  const match = source.match(
    /const existing =\s*[\s\S]*?if \(existing\) \{([\s\S]*?)\n    \}\n\n    if \(\n      openingProfiles\.has/,
  );

  assert.ok(
    match?.[1],
    "could not locate the existing-profile /profiles/open branch",
  );

  return match[1];
}

test("an already-running Browser profile routes to a newly requested start URL", async () => {
  const source = await readFile(
    path.resolve(
      __dirname,
      "index.ts",
    ),
    "utf8",
  );

  const existingBranch = readExistingProfileBranch(source);

  assert.match(
    existingBranch,
    /input\.startUrl/,
    "existing Browser sessions must inspect the requested startUrl instead of returning the old session immediately",
  );
  assert.match(
    existingBranch,
    /\.goto\(/,
    "existing Browser sessions must navigate the interactive tab to the requested target",
  );
  assert.match(
    existingBranch,
    /\.bringToFront\(/,
    "the requested channel target must become the visible Browser tab",
  );
  assert.match(
    existingBranch,
    /existing\.channelId\s*=/,
    "the live session must record which channel most recently routed the shared Browser account",
  );
});
