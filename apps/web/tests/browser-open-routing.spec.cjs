const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);

  assert.notEqual(
    start,
    -1,
    `Unable to find ${startMarker}`,
  );

  const end = source.indexOf(
    endMarker,
    start + startMarker.length,
  );

  assert.notEqual(
    end,
    -1,
    `Unable to find ${endMarker}`,
  );

  return source.slice(start, end);
}

test(
  "RuntimeProfileEditor lets the API resolve the selected channel Page target",
  async () => {
    const source = await readFile(
      "apps/web/src/components/settings/RuntimeProfileEditor.tsx",
      "utf8",
    );

    const block = extractFunction(
      source,
      "async function openBrowser()",
      "async function checkBrowserIp()",
    );

    assert.match(
      block,
      /\/automation\/channels\/\$\{channelId\}\/browser\/open/,
    );

    assert.doesNotMatch(
      block,
      /startUrl\s*:/,
      "channel browser open must not override the API-resolved Page target",
    );
  },
);

test(
  "Workspace channel Open Browser uses the channel-level routing endpoint",
  async () => {
    const source = await readFile(
      "apps/web/src/components/settings/WorkspaceSettings.tsx",
      "utf8",
    );

    const block = extractFunction(
      source,
      "async function openBrowserAccount(",
      "async function linkBrowserAccount(",
    );

    assert.match(
      block,
      /\/automation\/channels\/\$\{channel\.id\}\/browser\/open/,
      "Open Browser must preserve the selected channel id",
    );

    assert.doesNotMatch(
      block,
      /\/browser-runtime\/accounts\/\$\{accountId\}\/browser\/open/,
      "channel cards must not use the account-level browser open endpoint",
    );

    assert.doesNotMatch(
      block,
      /startUrl\s*:/,
      "channel browser open must not hardcode Facebook Home",
    );
  },
);
