import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as identity from "./page-identity.js";
import * as surface from "./page-publishing-surface.js";
import { releasePreparedPage } from "./prepared-page.js";

const targetId = "1292937667230187";
const targetUrl = "https://www.facebook.com/profile.php?id=1292937667230187";
const wrongUrl = "https://www.facebook.com/profile.php?id=1152201331300072";
const personalUrl = "https://www.facebook.com/profile.php?id=61592884960509";
const inboxUrl = "https://business.facebook.com/latest/inbox/all?asset_id=1292937667230187";
const caption = "Routing regression draft; never publish.";

// Execute the actual registered PREPARE handler, not a copy of its routing logic.
// Only external browser I/O and out-of-scope caption/media helpers are doubled.
// An optional source file lets the same behavioral test replay the exact base.
const source = readFileSync(
  process.env.FACEBOOK_PREPARE_TEST_SOURCE || path.resolve(__dirname, "../index.ts"),
  "utf8",
);
const marker = 'app.post(\n  "/profiles/:profileKey/facebook/prepare-post",';
const start = source.indexOf(marker);
assert.notEqual(start, -1, "PREPARE handler exists");
const end = source.indexOf("\napp.", start + marker.length);
assert.notEqual(end, -1, "PREPARE handler has a boundary");
const routeCode = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText;

type Scenario = {
  initialUrl?: string;
  pageLinkUrl?: string;
  pageLinkVisible?: boolean;
  recoveryUrl?: string;
  recoveryError?: boolean;
  switchDestinations?: string[];
  composerDestination?: string;
  fallbackUrl?: string;
  onboardingDestination?: string;
  screenshotDestination?: string;
  inboxBodyText?: string;
  targetBodyText?: string;
};

async function prepare(scenario: Scenario = {}) {
  let currentUrl = "about:blank";
  let closed = false;
  let captionWritten = false;
  let targetNavigations = 0;
  let switchClicks = 0;
  let fallbackClosed = false;
  const navigations: string[] = [];
  const composerSearchUrls: string[] = [];
  const composerClickUrls: string[] = [];
  const events: string[] = [];
  const logs: unknown[][] = [];
  const switchPending = () => switchClicks < (scenario.switchDestinations?.length || 0);
  const bodyText = () => switchPending()
    ? "Switch into M Story's Page to take more actions. Switch now"
    : currentUrl.includes("/login/")
      ? "Log in to Facebook. Email or phone number. Password. Log in."
      : currentUrl.includes("business.facebook.com")
        ? scenario.inboxBodyText ?? "Meta Business Suite Inbox M Story"
        : scenario.targetBodyText ?? "M Story Page · News and media website. Manage Page. Create post.";

  const locator = (kind: string) => {
    const visible = () => kind === "main" || kind === "editor" ||
      (kind === "switch" && switchPending()) ||
      (kind === "page-link" && scenario.pageLinkVisible !== false) ||
      (kind === "composer" && !currentUrl.includes("business.facebook.com"));
    const item = {
      first: () => item,
      nth: () => item,
      filter: ({ hasText }: { hasText: RegExp }) => namedLocator(hasText),
      count: async () => visible() ? 1 : 0,
      isVisible: async () => visible(),
      innerText: async () => kind === "body" ? bodyText() : captionWritten ? caption : "",
      textContent: async () => captionWritten ? caption : "",
      getAttribute: async (name: string) => name === "contenteditable" ? "true" : "textbox",
      evaluateAll: async () => [],
      click: async () => {
        if (kind === "switch") {
          currentUrl = scenario.switchDestinations![switchClicks++];
          events.push(`switch:${currentUrl}`);
        } else if (kind === "page-link") {
          currentUrl = scenario.pageLinkUrl ?? targetUrl;
          events.push(`page-link:${currentUrl}`);
        } else if (kind === "composer") {
          composerClickUrls.push(currentUrl);
          currentUrl = scenario.composerDestination ?? currentUrl;
        }
      },
    };
    return item;
  };
  const namedLocator = (name?: RegExp) => {
    if (name?.test("Create post")) {
      composerSearchUrls.push(currentUrl);
      return locator("composer");
    }
    return locator(name?.test("Switch now") ? "switch" : "missing");
  };
  const page = {
    url: () => currentUrl,
    goto: async (url: string, options?: unknown) => {
      navigations.push(url);
      events.push(`goto:${url}`);
      if (url === targetUrl) {
        targetNavigations++;
        if (targetNavigations > 1 && scenario.recoveryError) {
          throw new Error("Simulated recovery navigation timeout");
        }
        currentUrl = targetNavigations === 1
          ? scenario.initialUrl ?? targetUrl
          : scenario.recoveryUrl ?? targetUrl;
      } else {
        currentUrl = url;
      }
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    evaluate: async () => "complete",
    locator: (selector: string) => locator(
      selector === "body" ? "body"
        : selector === '[role="main"]' ? "main"
          : selector.startsWith('a[href*=') ? "page-link"
            : selector.includes('contenteditable') ? "editor" : "missing",
    ),
    getByRole: (_role: string, options?: { name?: RegExp }) => namedLocator(options?.name),
    getByText: (name: RegExp) => namedLocator(name),
    title: async () => currentUrl.includes("business.facebook.com") ? "Meta Business Suite" : "M Story",
    screenshot: async () => {
      currentUrl = scenario.screenshotDestination ?? currentUrl;
      return Buffer.from("test screenshot");
    },
    isClosed: () => closed,
    close: async () => { closed = true; },
  };
  const fallbackPage = {
    ...page,
    url: () => scenario.fallbackUrl!,
    isClosed: () => fallbackClosed,
    close: async () => { fallbackClosed = true; },
  };
  const session = {
    browserProfileKey: "routing-regression",
    context: { newPage: async () => page, pages: () => scenario.fallbackUrl ? [page, fallbackPage] : [page] },
    preparedPage: null as unknown,
    preparedFacebookMediaCount: 0,
  };
  let payload: any;
  let status = 200;
  let handler: ((request: unknown, response: unknown) => Promise<void>) | undefined;
  const response = {
    status: (value: number) => { status = value; return response; },
    json: (value: unknown) => { payload = value; return response; },
  };
  runInNewContext(routeCode, {
    ...identity,
    ...surface,
    Error, URL, Buffer, path,
    app: { post: (_route: string, callback: typeof handler) => { handler = callback; } },
    sessions: new Map([[session.browserProfileKey, session]]),
    console: { log: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) },
    releasePreparedPage,
    resetFacebookComposer: async () => ({ reset: true }),
    findFacebookCreatePostDialog: async (candidate: unknown) => {
      if (scenario.fallbackUrl && candidate === page) {
        throw new Error("No dialog in the automation tab");
      }
      return { locator: () => locator("editor") };
    },
    handleFacebookOnboarding: async () => {
      currentUrl = scenario.onboardingDestination ?? currentUrl;
      return {};
    },
    waitForFacebookComposerStable: async () => ({ stable: true }),
    fillFacebookComposerCaption: async () => {
      captionWritten = true;
      return { filled: true, writtenLength: caption.length };
    },
    saveBrowserScreenshot: async () => ({ absolutePath: "/test/unused.jpg", relativePath: "unused.jpg", filename: "unused.jpg" }),
  });
  assert.ok(handler);
  await handler({ params: { profileKey: session.browserProfileKey }, body: { targetUrl, caption } }, response);
  return { payload, status, session, navigations, composerSearchUrls, composerClickUrls, events, logs, closed, captionWritten, fallbackClosed };
}

test("PREPARE succeeds on the exact target without any recovery or publish", async () => {
  const result = await prepare();
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.published, false);
  assert.equal(result.payload.readyForReview, true);
  assert.deepEqual(result.navigations, [targetUrl]);
  assert.deepEqual(result.composerClickUrls, [targetUrl]);
});

test("PREPARE replays production mismatch -> Page link -> Business Inbox -> single recovery", async () => {
  const result = await prepare({ initialUrl: personalUrl, pageLinkUrl: inboxUrl });
  assert.equal(result.payload.success, true, result.payload.message);
  assert.deepEqual(result.navigations, [targetUrl, "https://www.facebook.com/pages/?category=your_pages", targetUrl]);
  assert.ok(result.logs.some(([message]) => message === "[facebook/page-target-mismatch]"));
  assert.deepEqual(result.composerClickUrls, [targetUrl]);
  assert.ok(result.composerSearchUrls.every((url) => url === targetUrl));
  assert.equal(result.payload.published, false);
});

test("PREPARE recovers when the identity-switch action redirects to Business Inbox", async () => {
  const result = await prepare({ switchDestinations: [inboxUrl] });
  assert.equal(result.payload.success, true, result.payload.message);
  assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
  assert.deepEqual(result.composerClickUrls, [targetUrl]);
  assert.ok(result.composerSearchUrls.every((url) => url === targetUrl));
});

for (const [label, finalUrl] of [
  ["Business Inbox", inboxUrl],
  ["another Page", wrongUrl],
  ["personal profile", personalUrl],
  ["unverifiable homepage", "https://www.facebook.com/"],
] as const) {
  test(`PREPARE never discovers composer when recovery ends on ${label}`, async () => {
    const result = await prepare({ initialUrl: inboxUrl, recoveryUrl: finalUrl });
    assert.equal(result.payload.success, false);
    assert.equal(result.status, 400);
    assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
    assert.deepEqual(result.composerSearchUrls, []);
    assert.equal(result.session.preparedPage, null);
    assert.equal(result.closed, true);
  });

  test(`PREPARE rechecks after recovery's identity switch ends on ${label}`, async () => {
    const result = await prepare({ initialUrl: inboxUrl, switchDestinations: [finalUrl] });
    assert.equal(result.payload.success, false);
    assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
    assert.deepEqual(result.composerSearchUrls, []);
    assert.equal(result.session.preparedPage, null);
  });
}

test("PREPARE preserves Page-switcher missing-target protection", async () => {
  const result = await prepare({ initialUrl: wrongUrl, pageLinkVisible: false });
  assert.equal(result.payload.success, false);
  assert.match(result.payload.message, /not available in the Page switcher/);
  assert.deepEqual(result.composerSearchUrls, []);
});

test("PREPARE fails closed after a Page-switcher click still reaches the wrong Page", async () => {
  const result = await prepare({ initialUrl: wrongUrl, pageLinkUrl: wrongUrl });
  assert.equal(result.payload.success, false);
  assert.deepEqual(result.composerSearchUrls, []);
});

test("PREPARE fails closed without retry when recovery navigation throws", async () => {
  const result = await prepare({ initialUrl: inboxUrl, recoveryError: true });
  assert.equal(result.payload.success, false);
  assert.match(result.payload.message, /recovery navigation/);
  assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
  assert.deepEqual(result.composerSearchUrls, []);
});

for (const [label, scenario] of [
  ["initial navigation", { initialUrl: "https://www.facebook.com/login/" }],
  ["recovery", { initialUrl: inboxUrl, recoveryUrl: "https://www.facebook.com/login/" }],
  ["identity switch", { switchDestinations: ["https://www.facebook.com/login/"] }],
  ["identity switch showing login at the Page URL", {
    switchDestinations: [targetUrl],
    targetBodyText: "Log in to Facebook. Email or phone number. Password. Log in.",
  }],
] as const) {
  test(`PREPARE preserves loginRequired after ${label}`, async () => {
    const result = await prepare(scenario as Scenario);
    assert.equal(result.status, 400);
    assert.equal(result.payload.success, false);
    assert.equal(result.payload.loginRequired, true);
    assert.equal(result.session.preparedPage, null);
    assert.equal(result.captionWritten, false);
    assert.deepEqual(result.composerSearchUrls, []);
  });
}

for (const [label, finalUrl] of [
  ["Business Inbox", inboxUrl],
  ["another Page", wrongUrl],
  ["personal profile", personalUrl],
  ["unverifiable homepage", "https://www.facebook.com/"],
] as const) {
  test(`PREPARE rejects composer-click navigation to ${label} before filling`, async () => {
    const result = await prepare({ composerDestination: finalUrl });
    assert.equal(result.status, 400);
    assert.equal(result.payload.success, false);
    assert.equal(result.captionWritten, false);
    assert.equal(result.session.preparedPage, null);
    assert.deepEqual(result.navigations, [targetUrl]);
  });

  test(`PREPARE rejects an existing ${label} composer tab without editing or closing it`, async () => {
    const result = await prepare({ fallbackUrl: finalUrl });
    assert.equal(result.status, 400);
    assert.equal(result.payload.success, false);
    assert.equal(result.captionWritten, false);
    assert.equal(result.session.preparedPage, null);
    assert.equal(result.fallbackClosed, false);
    assert.equal(result.closed, true);
    assert.deepEqual(result.navigations, [targetUrl]);
  });
}

test("PREPARE accepts an exact-target composer in another tab", async () => {
  const result = await prepare({ fallbackUrl: targetUrl });
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.published, false);
  assert.equal(result.payload.page.url, targetUrl);
  assert.equal(result.closed, true);
  assert.equal(result.fallbackClosed, false);
});

test("PREPARE rejects late onboarding navigation before filling the caption", async () => {
  const result = await prepare({ onboardingDestination: wrongUrl });
  assert.equal(result.payload.success, false);
  assert.equal(result.captionWritten, false);
  assert.equal(result.session.preparedPage, null);
});

test("PREPARE never returns readyForReview after a final screenshot navigation", async () => {
  const result = await prepare({ screenshotDestination: wrongUrl });
  assert.equal(result.payload.success, false);
  assert.notEqual(result.payload.readyForReview, true);
  assert.equal(result.session.preparedPage, null);
});

test("PREPARE recovers an identity-switch Inbox redirect without Page-name evidence", async () => {
  const result = await prepare({ switchDestinations: [inboxUrl], inboxBodyText: "Meta Business Suite Inbox" });
  assert.equal(result.payload.success, true, result.payload.message);
  assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
  assert.deepEqual(result.composerClickUrls, [targetUrl]);
});

test("PREPARE retains failed identity evidence on an otherwise exact Page URL", async () => {
  const result = await prepare({ switchDestinations: [targetUrl], targetBodyText: "Welcome. Create post." });
  assert.equal(result.payload.success, false);
  assert.match(result.payload.message, /TARGET_IDENTITY_NOT_VERIFIED/);
  assert.deepEqual(result.composerSearchUrls, []);
});

test("PREPARE cannot spend recovery twice when identity evidence is missing on Inbox", async () => {
  const result = await prepare({ initialUrl: inboxUrl, switchDestinations: [inboxUrl], inboxBodyText: "Meta Business Suite Inbox" });
  assert.equal(result.payload.success, false);
  assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
  assert.deepEqual(result.composerSearchUrls, []);
});

test("PREPARE rejects a recovered Page lacking the original switch-target evidence", async () => {
  const result = await prepare({
    switchDestinations: [inboxUrl],
    inboxBodyText: "Meta Business Suite Inbox",
    targetBodyText: "Welcome. Create post.",
  });
  assert.equal(result.payload.success, false);
  assert.deepEqual(result.navigations, [targetUrl, targetUrl]);
  assert.deepEqual(result.composerSearchUrls, []);
});
