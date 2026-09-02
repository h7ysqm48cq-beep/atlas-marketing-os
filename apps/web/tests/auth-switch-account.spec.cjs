const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

test("Atlas allows an explicit account switch without disabling auth isolation", async () => {
  const proxy = await readFile("apps/web/src/proxy.ts", "utf8");
  const login = await readFile("apps/web/src/app/login/page.tsx", "utf8");
  const userMenu = await readFile("apps/web/src/components/UserMenu.tsx", "utf8");

  assert.match(
    proxy,
    /pathname\s*===\s*["']\/login["'][\s\S]{0,300}searchParams\.get\(["']switch["']\)\s*===\s*["']1["']/,
    "proxy must detect the explicit /login?switch=1 account-switch route",
  );

  assert.match(
    proxy,
    /claims\s*&&[\s\S]{0,200}pathname\s*===\s*["']\/login["'][\s\S]{0,200}!switchAccount/,
    "normal authenticated /login visits should still redirect, but explicit switching must be allowed",
  );

  assert.match(
    login,
    /signOut\(\{\s*scope:\s*["']local["']\s*\}\)/,
    "account switching must clear only this browser session",
  );

  assert.match(
    userMenu,
    /\/login\?switch=1/,
    "account menu must expose an explicit Switch account route",
  );
});
