import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexPath =
  "apps/browser-worker/src/index.ts";

async function readWorkerSource() {
  return readFile(
    indexPath,
    "utf8",
  );
}

function extractInspectRoute(
  source: string,
) {
  const marker =
    'app.post(\n  "/profiles/:profileKey/inspect",';

  const start =
    source.indexOf(marker);

  assert.notEqual(
    start,
    -1,
    "Worker browser inspect route was not found",
  );

  const end =
    source.indexOf(
      "\napp.",
      start + marker.length,
    );

  assert.notEqual(
    end,
    -1,
    "Worker browser inspect route end was not found",
  );

  return source.slice(
    start,
    end,
  );
}

test(
  "browser inspect integrates Facebook personal account identity detection",
  async () => {
    const source =
      await readWorkerSource();

    const block =
      extractInspectRoute(
        source,
      );

    assert.match(
      source,
      /from "\.\/facebook\/account-identity\.js"/,
      "Worker must import the Facebook account identity helper",
    );

    assert.match(
      block,
      /inspectFacebookAccountIdentity\(/,
      "browser inspect must invoke personal Facebook identity detection",
    );
  },
);

test(
  "browser inspect returns Facebook user id and name when detected",
  async () => {
    const source =
      await readWorkerSource();

    const block =
      extractInspectRoute(
        source,
      );

    assert.match(
      block,
      /facebookUserId/,
      "browser inspect must expose facebookUserId",
    );

    assert.match(
      block,
      /facebookUserName/,
      "browser inspect must expose facebookUserName",
    );
  },
);


test(
  "Facebook profile-name capture avoids the global Facebook chrome heading",
  async () => {
    const source =
      await readWorkerSource();

    const block =
      extractInspectRoute(
        source,
      );

    assert.doesNotMatch(
      block,
      /identityPage\s*\.locator\("h1"\)\s*\.first\(\)/,
      "profile-name capture must not trust the first global h1",
    );

    assert.match(
      block,
      /meta\[property="og:title"\]/,
      "profile-name capture should inspect Facebook profile metadata",
    );

    assert.match(
      block,
      /\[role="main"\] h1/,
      "profile-name capture should scope visible headings to profile content",
    );
  },
);
