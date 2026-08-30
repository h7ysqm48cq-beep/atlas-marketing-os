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

test(
  "automatic Live Browser viewer does not reopen an already-running Browser Account",
  async () => {
    const source = await readFile(
      "apps/web/src/components/automation/BrowserAccountsManagerV2.tsx",
      "utf8",
    );

    const start = source.indexOf(
      "if (\n      !requestedViewerOpen",
    );

    assert.notEqual(
      start,
      -1,
      "automatic viewer effect not found",
    );

    const end = source.indexOf(
      "async function verifyLogin(",
      start,
    );

    assert.notEqual(
      end,
      -1,
      "automatic viewer effect end not found",
    );

    const block = source.slice(start, end);

    assert.match(
      block,
      /runtimes\[selectedAccount\.id\]/,
      "automatic viewer must wait for the selected Browser Account runtime",
    );

    assert.match(
      block,
      /connectSecureBrowserViewer\(\)/,
      "an already-running browser must only connect the viewer",
    );

    assert.match(
      block,
      /running/,
      "automatic viewer must branch on the existing browser running state",
    );
  },
);

test(
  "Automation Dashboard lets the API resolve the selected Facebook Page target",
  async () => {
    const source = await readFile(
      "apps/web/src/components/automation/AutomationDashboard.tsx",
      "utf8",
    );

    const block = extractFunction(
      source,
      "async function openBrowser()",
      "async function checkBrowserStatus()",
    );

    assert.match(
      block,
      /\/automation\/channels\/\$\{selectedBrowserChannelId\}\/browser\/open/,
      "Automation must preserve the selected channel id",
    );

    assert.doesNotMatch(
      block,
      /https:\/\/www\.facebook\.com\//,
      "Facebook Automation open must not override the API-resolved Page target",
    );

    assert.match(
      block,
      /https:\/\/www\.instagram\.com\//,
      "Instagram browser routing must remain explicit",
    );
  },
);

test(
  "Connected platforms preserves the selected Facebook channel into Browser Accounts",
  async () => {
    const pageSource = await readFile(
      "apps/web/src/app/automation/browser-accounts/page.tsx",
      "utf8",
    );

    assert.match(
      pageSource,
      /requestedChannelId=\{[\s\S]*params\.channelId/,
      "Browser Accounts page must forward the selected channelId",
    );
  },
);

test(
  "Browser Accounts uses channel-level routing when opened from Connected platforms",
  async () => {
    const source = await readFile(
      "apps/web/src/components/automation/BrowserAccountsManagerV2.tsx",
      "utf8",
    );

    assert.match(
      source,
      /requestedChannelId\?: string \| null/,
      "Browser Accounts manager must accept channel context",
    );

    const start = source.indexOf(
      "async function openBrowser(accountId: string)",
    );

    assert.notEqual(
      start,
      -1,
      "openBrowser function not found",
    );

    const end = source.indexOf(
      "async function verifyLogin(",
      start,
    );

    assert.notEqual(
      end,
      -1,
      "openBrowser function end not found",
    );

    const block = source.slice(start, end);

    assert.match(
      block,
      /\/automation\/channels\/\$\{requestedChannelId\}\/browser\/open/,
      "channel-aware Browser Accounts open must use the channel endpoint",
    );

    assert.match(
      block,
      /\/browser-runtime\/accounts\/\$\{accountId\}\/browser\/open/,
      "normal Browser Accounts open must retain the account-level fallback",
    );
  },
);
