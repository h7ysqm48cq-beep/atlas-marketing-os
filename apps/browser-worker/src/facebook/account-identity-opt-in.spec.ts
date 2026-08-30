import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import test from "node:test";

const source =
  readFileSync(
    require.resolve(
      "../index.ts",
    ),
    "utf8",
  );

const routeStart =
  source.indexOf(
    [
      "app.post(",
      '  "/profiles/:profileKey/inspect",',
    ].join("\n"),
  );

assert.notEqual(
  routeStart,
  -1,
  "inspect route must exist",
);

const nextRoute =
  source.indexOf(
    "\napp.",
    routeStart + 20,
  );

const inspectRoute =
  source.slice(
    routeStart,
    nextRoute === -1
      ? source.length
      : nextRoute,
  );

test(
  "Facebook personal identity capture is opt-in",
  () => {
    assert.match(
      inspectRoute,
      /request\.body\?\.captureFacebookIdentity\s*===\s*true/,
    );

    assert.match(
      inspectRoute,
      /captureFacebookIdentity[\s\S]*inspectFacebookAccountIdentity/,
    );
  },
);

test(
  "Facebook identity capture does not bring the existing page to front",
  () => {
    assert.doesNotMatch(
      inspectRoute,
      /\.bringToFront\s*\(/,
    );
  },
);
