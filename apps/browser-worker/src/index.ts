import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  chromium,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
} from "playwright-core";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  handleDialogs,
} from "./browser-core/dialog-engine.js";
import {
  countFacebookComposerImagePreviews,
  FacebookComposerImageUploadError,
  findFacebookCreatePostDialog,
  fillFacebookComposerCaption,
  resetFacebookComposer,
  uploadFacebookComposerImages,
  waitForFacebookComposerImagePreviews,
  waitForFacebookComposerStable,
} from "./facebook/composer.js";
import {
  findFacebookPublishedPostReference,
  hasFacebookPublishErrorSignal,
  hasFacebookPublishSuccessSignal,
  resolveFacebookPublishedFlag,
  resolveFacebookPublishVerificationStatus,
  shouldRefreshFacebookPublishConfirmation,
} from "./facebook/published-post.js";
import {
  ensureFacebookPageIdentitySwitch,
  facebookPageSwitchActionPattern,
  hasFacebookPageSwitchPrompt,
} from "./facebook/page-identity.js";
import {
  filterFacebookPageCandidates,
} from "./facebook/page-discovery.js";
import {
  classifyFacebookInspectionTab,
  selectFacebookInspectionTab,
} from "./facebook/inspection-page.js";
import {
  attachInstagramMedia,
  clickInstagramNext,
  clickInstagramShare,
  fillInstagramCaption,
  findInstagramDialog,
  openInstagramComposer,
} from "./instagram/composer.js";
import {
  saveBrowserScreenshot,
} from "./browser-screenshot-store.js";
import {
  hasFacebookPublishNetworkError,
  startFacebookPublishNetworkCapture,
} from "./facebook/publish-network.js";
import {
  startSecureViewerServer,
} from "./viewer-server.js";

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type BrowserProfileInput = {
  channelId: string;
  browserProfileKey: string;
  browserProfileName?: string;

  browserEngine?: string;
  operatingSystem?: string;
  userAgent?: string | null;

  viewport?: {
    width?: number;
    height?: number;
  } | null;

  screenWidth?: number;
  screenHeight?: number;
  deviceScaleFactor?: number;
  colorScheme?:
    | "light"
    | "dark"
    | "no-preference";

  locale?: string;
  timezone?: string;

  identityLocked?: boolean;
  identityVersion?: number;
  fingerprintStatus?: string;

  proxyType?: ProxyType;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;

  expectedIp?: string | null;
  lastKnownIp?: string | null;
  ipStatus?: string;

  headless?: boolean;
  startUrl?: string;
};

type BrowserSession = {
  channelId: string;
  browserProfileKey: string;
  browserProfileName: string | null;
  profileDirectory: string;
  context: BrowserContext;
  openedAt: string;

  browserEngine: string;
  operatingSystem: string;
  userAgent: string | null;

  viewport: {
    width: number;
    height: number;
  };

  deviceScaleFactor: number;
  colorScheme:
    | "light"
    | "dark"
    | "no-preference";

  locale: string;
  timezone: string;
  proxyType: ProxyType;
  identityLocked: boolean;
  identityVersion: number;
  headless: boolean;
  currentUrl: string | null;
  preparedFacebookMediaCount: number;
};

const app = express();

app.use(
  express.json({
    limit: "1mb",
  }),
);

const port =
  Number(
    process.env.PORT ||
      process.env.BROWSER_WORKER_PORT ||
      4010,
  );

const executablePath =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profilesRoot =
  process.env.BROWSER_PROFILES_ROOT ||
  path.resolve(
    process.cwd(),
    ".browser-profiles",
  );

const workerToken =
  process.env.BROWSER_WORKER_TOKEN?.trim();

const sessions =
  new Map<
    string,
    BrowserSession
  >();

const openingProfiles =
  new Set<string>();

async function getPreferredFacebookPage(
  context: BrowserContext,
) {
  const pages = context.pages();

  if (!pages.length) {
    return context.newPage();
  }

  const tabs = await Promise.all(
    pages.map(async (page) => {
      const url = page.url();
      const text = await page
        .locator("body")
        .innerText({ timeout: 3000 })
        .catch(() => "");
      const hasVisiblePassword =
        (await page
          .locator('input[type="password"]:visible')
          .count()
          .catch(() => 0)) > 0;
      const classification =
        classifyFacebookInspectionTab({
          url,
          text,
          hasVisiblePassword,
        });

      return {
        url,
        loginRequired:
          classification.loginRequired,
        challenge:
          classification.challenge,
      };
    }),
  );

  const selectedIndex =
    selectFacebookInspectionTab(tabs);

  return pages[selectedIndex] || pages.at(-1)!;
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const normalized =
    Number(value);

  if (
    !Number.isInteger(
      normalized,
    ) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    return fallback;
  }

  return normalized;
}

function normalizeScaleFactor(
  value: unknown,
) {
  const normalized =
    Number(value);

  if (
    !Number.isFinite(
      normalized,
    ) ||
    normalized < 0.5 ||
    normalized > 4
  ) {
    return 1;
  }

  return normalized;
}

function normalizeColorScheme(
  value: unknown,
):
  | "light"
  | "dark"
  | "no-preference" {
  if (
    value === "dark" ||
    value === "no-preference"
  ) {
    return value;
  }

  return "light";
}


function isProfileLockError(
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const normalized =
    message.toLowerCase();

  return (
    normalized.includes(
      "profile appears to be in use",
    ) ||
    normalized.includes(
      "process_singleton",
    ) ||
    normalized.includes(
      "singletonlock",
    ) ||
    normalized.includes(
      "chromium has locked the profile",
    )
  );
}

async function removeStaleProfileLocks(
  profileDirectory: string,
) {
  const {
    lstat,
    readlink,
    rm,
  } = await import(
    "node:fs/promises"
  );

  const lockNames = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
  ];

  const removed:
    string[] = [];

  const skipped:
    string[] = [];

  for (
    const lockName
    of lockNames
  ) {
    const lockPath =
      path.join(
        profileDirectory,
        lockName,
      );

    try {
      const stat =
        await lstat(
          lockPath,
        );

      let lockTarget:
        string | null = null;

      if (
        stat.isSymbolicLink()
      ) {
        lockTarget =
          await readlink(
            lockPath,
          ).catch(
            () => null,
          );
      }

      /*
       * A recovery attempt is only called after:
       * - no Worker session exists for this profile;
       * - Chromium returned a profile-lock error.
       *
       * Do not remove any other profile files.
       */
      await rm(
        lockPath,
        {
          force: true,
          recursive:
            stat.isDirectory(),
        },
      );

      removed.push(
        lockTarget
          ? `${lockName}:${lockTarget}`
          : lockName,
      );
    } catch (
      error
    ) {
      const code =
        error &&
        typeof error ===
          "object" &&
        "code" in error
          ? String(
              (
                error as {
                  code?: unknown;
                }
              ).code,
            )
          : "";

      if (
        code ===
        "ENOENT"
      ) {
        skipped.push(
          lockName,
        );
        continue;
      }

      throw error;
    }
  }

  return {
    removed,
    skipped,
  };
}

type FrameInputInspection = {
  frameUrl: string;
  frameName: string;
  textPreview: string;
  inputs: Array<{
    tag: string;
    type: string | null;
    name: string | null;
    id: string | null;
    placeholder: string | null;
    autocomplete: string | null;
    inputMode: string | null;
    ariaLabel: string | null;
    contentEditable: string | null;
    visible: boolean;
  }>;
  buttons: Array<{
    text: string;
    ariaLabel: string | null;
    role: string | null;
    tag: string;
    visible: boolean;
  }>;
};


async function locatorIsVisible(
  locator: Locator,
): Promise<boolean> {
  return locator
    .isVisible()
    .catch(() => false);
}


async function findVisibleLocatorAcrossFrames(
  page: Page,
  selectors: string[],
): Promise<{
  frame: Frame;
  locator: Locator;
  selector: string;
} | null> {
  const frames =
    page.frames();

  for (
    const frame
    of frames
  ) {
    for (
      const selector
      of selectors
    ) {
      const candidates =
        frame.locator(
          selector,
        );

      const count =
        await candidates
          .count()
          .catch(() => 0);

      for (
        let index = 0;
        index < count;
        index += 1
      ) {
        const candidate =
          candidates.nth(
            index,
          );

        if (
          await locatorIsVisible(
            candidate,
          )
        ) {
          return {
            frame,
            locator:
              candidate,
            selector,
          };
        }
      }
    }
  }

  return null;
}


async function findVisibleButtonAcrossFrames(
  page: Page,
  patterns: RegExp[],
): Promise<{
  frame: Frame;
  locator: Locator;
  pattern: string;
} | null> {
  const frames =
    page.frames();

  for (
    const frame
    of frames
  ) {
    for (
      const pattern
      of patterns
    ) {
      const candidates = [
        frame
          .getByRole(
            "button",
            {
              name:
                pattern,
            },
          ),
        frame.locator(
          [
            'button[type="submit"]',
            'input[type="submit"]',
            '[role="button"]',
          ].join(", "),
        ),
      ];

      for (
        const candidateGroup
        of candidates
      ) {
        const count =
          await candidateGroup
            .count()
            .catch(() => 0);

        for (
          let index = 0;
          index < count;
          index += 1
        ) {
          const candidate =
            candidateGroup.nth(
              index,
            );

          if (
            !await locatorIsVisible(
              candidate,
            )
          ) {
            continue;
          }

          const text =
            (
              await candidate
                .innerText()
                .catch(() => "")
            )
              .trim();

          const value =
            (
              await candidate
                .getAttribute(
                  "value",
                )
                .catch(() => null)
            ) || "";

          const ariaLabel =
            (
              await candidate
                .getAttribute(
                  "aria-label",
                )
                .catch(() => null)
            ) || "";

          const combinedText =
            [
              text,
              value,
              ariaLabel,
            ]
              .join(" ")
              .trim();

          if (
            pattern.test(
              combinedText,
            )
          ) {
            return {
              frame,
              locator:
                candidate,
              pattern:
                pattern.toString(),
            };
          }
        }
      }
    }
  }

  return null;
}


async function inspectAllFrames(
  page: Page,
): Promise<
  FrameInputInspection[]
> {
  const results:
    FrameInputInspection[] = [];

  const frames =
    page.frames();

  for (
    const frame
    of frames
  ) {
    try {
      const textPreview =
        (
          await frame
            .locator("body")
            .innerText({
              timeout:
                5000,
            })
            .catch(() => "")
        )
          .replace(
            /\s+/g,
            " ",
          )
          .trim()
          .slice(
            0,
            3000,
          );

      const inputs =
        await frame
          .locator(
            [
              "input",
              "textarea",
              '[contenteditable="true"]',
            ].join(", "),
          )
          .evaluateAll(
            (elements) =>
              elements
                .slice(
                  0,
                  100,
                )
                .map(
                  (
                    element,
                  ) => {
                    const html =
                      element as HTMLElement;

                    const style =
                      window
                        .getComputedStyle(
                          html,
                        );

                    const visible =
                      style.display !==
                        "none" &&
                      style.visibility !==
                        "hidden" &&
                      html.offsetParent !==
                        null;

                    return {
                      tag:
                        html.tagName
                          .toLowerCase(),
                      type:
                        element
                          .getAttribute(
                            "type",
                          ),
                      name:
                        element
                          .getAttribute(
                            "name",
                          ),
                      id:
                        element
                          .getAttribute(
                            "id",
                          ),
                      placeholder:
                        element
                          .getAttribute(
                            "placeholder",
                          ),
                      autocomplete:
                        element
                          .getAttribute(
                            "autocomplete",
                          ),
                      inputMode:
                        element
                          .getAttribute(
                            "inputmode",
                          ),
                      ariaLabel:
                        element
                          .getAttribute(
                            "aria-label",
                          ),
                      contentEditable:
                        element
                          .getAttribute(
                            "contenteditable",
                          ),
                      visible,
                    };
                  },
                ),
          )
          .catch(
            () => [],
          );

      const buttons =
        await frame
          .locator(
            [
              "button",
              '[role="button"]',
              'input[type="submit"]',
            ].join(", "),
          )
          .evaluateAll(
            (elements) =>
              elements
                .slice(
                  0,
                  100,
                )
                .map(
                  (
                    element,
                  ) => {
                    const html =
                      element as HTMLElement;

                    const style =
                      window
                        .getComputedStyle(
                          html,
                        );

                    const visible =
                      style.display !==
                        "none" &&
                      style.visibility !==
                        "hidden" &&
                      html.offsetParent !==
                        null;

                    return {
                      text:
                        (
                          html.innerText ||
                          html.getAttribute(
                            "value",
                          ) ||
                          ""
                        )
                          .trim()
                          .slice(
                            0,
                            200,
                          ),
                      ariaLabel:
                        html.getAttribute(
                          "aria-label",
                        ),
                      role:
                        html.getAttribute(
                          "role",
                        ),
                      tag:
                        html.tagName
                          .toLowerCase(),
                      visible,
                    };
                  },
                ),
          )
          .catch(
            () => [],
          );

      results.push({
        frameUrl:
          frame.url(),
        frameName:
          frame.name(),
        textPreview,
        inputs,
        buttons,
      });
    } catch {
      results.push({
        frameUrl:
          frame.url(),
        frameName:
          frame.name(),
        textPreview:
          "",
        inputs:
          [],
        buttons:
          [],
      });
    }
  }

  return results;
}

function requireWorkerToken(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (
    request.path ===
      "/health" ||
    !workerToken
  ) {
    next();
    return;
  }

  const authorization =
    request.headers.authorization;

  const suppliedToken =
    authorization?.startsWith(
      "Bearer ",
    )
      ? authorization
          .slice(7)
          .trim()
      : "";

  if (
    !suppliedToken ||
    suppliedToken !== workerToken
  ) {
    response.status(401).json({
      message:
        "Invalid Browser Worker token.",
    });
    return;
  }

  next();
}

function sanitizeProfileKey(
  value: string,
) {
  const clean =
    value.trim();

  if (
    !/^[a-zA-Z0-9_-]+$/.test(
      clean,
    )
  ) {
    throw new Error(
      "browserProfileKey contains invalid characters.",
    );
  }

  return clean;
}

function buildProxy(
  input: BrowserProfileInput,
) {
  const proxyType =
    input.proxyType ||
    "DIRECT";

  if (
    proxyType === "DIRECT"
  ) {
    return undefined;
  }

  const host =
    input.proxyHost?.trim();

  const proxyPort =
    input.proxyPort;

  if (
    !host ||
    !proxyPort
  ) {
    throw new Error(
      "Proxy host and port are required.",
    );
  }

  if (
    !Number.isInteger(
      proxyPort,
    ) ||
    proxyPort < 1 ||
    proxyPort > 65535
  ) {
    throw new Error(
      "Proxy port must be between 1 and 65535.",
    );
  }

  const protocol =
    proxyType === "SOCKS5"
      ? "socks5"
      : proxyType === "HTTPS"
        ? "https"
        : "http";

  return {
    server:
      `${protocol}://${host}:${proxyPort}`,
    username:
      input.proxyUsername?.trim() ||
      undefined,
    password:
      input.proxyPassword ||
      undefined,
  };
}

async function handleFacebookOnboarding(
  page: import("playwright-core").Page,
) {
  return handleDialogs(
    page,
    {
      maxIterations: 8,
      waitAfterActionMs: 900,
    },
  );
}



function safeSession(
  session: BrowserSession,
) {
  return {
    channelId:
      session.channelId,
    browserProfileKey:
      session.browserProfileKey,
    profileDirectory:
      session.profileDirectory,
    openedAt:
      session.openedAt,
    locale:
      session.locale,
    timezone:
      session.timezone,
    proxyType:
      session.proxyType,
    headless:
      session.headless,
    currentUrl:
      session.currentUrl,
  };
}

async function resolveProfileDirectory(
  browserProfileKey: string,
) {
  const safeKey =
    sanitizeProfileKey(
      browserProfileKey,
    );

  await mkdir(
    profilesRoot,
    {
      recursive: true,
    },
  );

  const resolvedRoot =
    await realpath(
      profilesRoot,
    );

  const profileDirectory =
    path.resolve(
      resolvedRoot,
      safeKey,
    );

  const relative =
    path.relative(
      resolvedRoot,
      profileDirectory,
    );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Browser profile path escapes the profiles root.",
    );
  }

  await mkdir(
    profileDirectory,
    {
      recursive: true,
    },
  );

  return profileDirectory;
}

async function inspectPublicIp(
  context: BrowserContext,
): Promise<string | null> {
  const page =
    context.pages()[0] ||
    (await context.newPage());

  await page.goto(
    "https://api.ipify.org?format=json",
    {
      waitUntil:
        "domcontentloaded",
      timeout:
        20000,
    },
  );

  const body =
    await page.textContent(
      "body",
    );

  try {
    const result =
      JSON.parse(
        body || "{}",
      ) as {
        ip?: unknown;
      };

    const ip =
      String(
        result.ip ?? "",
      ).trim();

    return ip || null;
  } catch {
    return null;
  }
}

app.use(
  requireWorkerToken,
);

app.get(
  "/health",
  (_request, response) => {
    response.json({
      healthy: true,
      service:
        "atlas-browser-worker",
      executablePath,
      profilesRoot,
      authenticationEnabled:
        Boolean(workerToken),
      activeSessions:
        sessions.size,
    });
  },
);


app.get(
  "/profiles",
  (_request, response) => {
    response.json({
      count:
        sessions.size,
      sessions:
        Array.from(
          sessions.values(),
        ).map(
          safeSession,
        ),
    });
  },
);

app.get(
  "/profiles/:profileKey/status",
  (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.json({
        running: false,
        browserProfileKey:
          profileKey,
      });
      return;
    }

    response.json({
      running: true,
      session:
        safeSession(
          session,
        ),
    });
  },
);

app.post(
  "/profiles/open",
  async (request, response) => {
    const input =
      request.body as BrowserProfileInput;

    if (
      !input.channelId?.trim() ||
      !input.browserProfileKey?.trim()
    ) {
      response.status(400).json({
        message:
          "channelId and browserProfileKey are required.",
      });
      return;
    }

    let profileKey: string;

    try {
      profileKey =
        sanitizeProfileKey(
          input.browserProfileKey,
        );
    } catch (error) {
      response.status(400).json({
        message:
          error instanceof Error
            ? error.message
            : "Invalid browser profile key.",
      });
      return;
    }

    const existing =
      sessions.get(
        profileKey,
      );

    if (existing) {
      response.json({
        opened: false,
        alreadyRunning: true,
        session:
          safeSession(
            existing,
          ),
      });
      return;
    }

    if (
      openingProfiles.has(
        profileKey,
      )
    ) {
      response.status(409).json({
        opened: false,
        alreadyRunning: false,
        message:
          "Browser profile is already opening.",
      });
      return;
    }

    openingProfiles.add(
      profileKey,
    );

    const locale =
      input.locale?.trim() ||
      "en-MY";

    const timezone =
      input.timezone?.trim() ||
      "Asia/Kuala_Lumpur";

    const proxyType =
      input.proxyType ||
      "DIRECT";

    const headless =
      input.headless ?? false;

    const browserEngine =
      input.browserEngine
        ?.trim()
        .toLowerCase() ||
      "chromium";

    if (
      browserEngine !==
      "chromium"
    ) {
      response.status(400).json({
        opened: false,
        message:
          `Browser engine ${browserEngine} is not supported by this Worker deployment.`,
      });
      return;
    }

    const operatingSystem =
      input.operatingSystem
        ?.trim() ||
      "macOS";

    const viewport = {
      width:
        normalizeInteger(
          input.viewport?.width ??
            input.screenWidth,
          1365,
          800,
          7680,
        ),

      height:
        normalizeInteger(
          input.viewport?.height ??
            input.screenHeight,
          768,
          600,
          4320,
        ),
    };

    const deviceScaleFactor =
      normalizeScaleFactor(
        input.deviceScaleFactor,
      );

    const colorScheme =
      normalizeColorScheme(
        input.colorScheme,
      );

    const userAgent =
      input.userAgent?.trim() ||
      null;

    const identityLocked =
      input.identityLocked ??
      true;

    const identityVersion =
      normalizeInteger(
        input.identityVersion,
        1,
        1,
        100000,
      );

    const startUrl =
      input.startUrl?.trim() ||
      "https://www.facebook.com/";

    try {
      const profileDirectory =
        await resolveProfileDirectory(
          profileKey,
        );

      const launchOptions = {
        executablePath,
        headless,

        locale,

        timezoneId:
          timezone,

        userAgent:
          userAgent ||
          undefined,

        viewport,

        screen: {
          width:
            viewport.width,
          height:
            viewport.height,
        },

        deviceScaleFactor,

        colorScheme,

        proxy:
          buildProxy(
            input,
          ),
      };

      let context:
        BrowserContext;

      let lockRecovery:
        {
          attempted: boolean;
          removed: string[];
          skipped: string[];
        } = {
          attempted: false,
          removed: [],
          skipped: [],
        };

      try {
        context =
          await chromium
            .launchPersistentContext(
              profileDirectory,
              launchOptions,
            );
      } catch (error) {
        if (
          !isProfileLockError(
            error,
          ) ||
          sessions.has(
            profileKey,
          )
        ) {
          throw error;
        }

        const recovery =
          await removeStaleProfileLocks(
            profileDirectory,
          );

        lockRecovery = {
          attempted: true,
          removed:
            recovery.removed,
          skipped:
            recovery.skipped,
        };

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              750,
            ),
        );

        context =
          await chromium
            .launchPersistentContext(
              profileDirectory,
              launchOptions,
            );
      }

      const page =
        context.pages()[0] ||
        (await context.newPage());

      await page.goto(
        startUrl,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 30000,
        },
      );

      const session:
        BrowserSession = {
          channelId:
            input.channelId,

          browserProfileKey:
            profileKey,

          browserProfileName:
            input.browserProfileName
              ?.trim() ||
            null,

          profileDirectory,
          context,

          openedAt:
            new Date()
              .toISOString(),

          browserEngine,
          operatingSystem,
          userAgent,
          viewport,
          deviceScaleFactor,
          colorScheme,

          locale,
          timezone,
          proxyType,

          identityLocked,
          identityVersion,

          headless,

          currentUrl:
            page.url(),

          preparedFacebookMediaCount:
            0,
        };

      sessions.set(
        profileKey,
        session,
      );

      context.on(
        "close",
        () => {
          sessions.delete(
            profileKey,
          );
        },
      );

      response.json({
        opened: true,
        alreadyRunning:
          false,
        lockRecovery,
        session:
          safeSession(
            session,
          ),
      });
    } catch (error) {
      response.status(400).json({
        opened: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to open browser profile.",
      });
    } finally {
      openingProfiles.delete(
        profileKey,
      );
    }
  },
);

app.post(
  "/profiles/:profileKey/facebook/debug-fill-caption",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(profileKey);

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    const input =
      request.body as {
        caption?: string;
      };

    const caption =
      input.caption?.trim();

    if (!caption) {
      response.status(400).json({
        success: false,
        message:
          "Caption is required.",
      });
      return;
    }

    try {
      const page =
        await getPreferredFacebookPage(
          session.context,
        );

      const editors =
        page.locator(
          '[role="dialog"] [contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-placeholder*="mind" i]',
        );

      const count =
        await editors.count();

      const visibleEditors = [];

      for (
        let index = 0;
        index < count;
        index += 1
      ) {
        const editor =
          editors.nth(index);

        if (
          await editor
            .isVisible()
            .catch(() => false)
        ) {
          visibleEditors.push({
            index,
            editor,
          });
        }
      }

      if (!visibleEditors.length) {
        throw new Error(
          "No visible Facebook caption editor was found.",
        );
      }

      const target =
        visibleEditors[
          visibleEditors.length - 1
        ].editor;

      const before = {
        innerText:
          await target
            .innerText()
            .catch(() => ""),
        textContent:
          await target
            .textContent()
            .catch(() => ""),
        ariaPlaceholder:
          await target
            .getAttribute(
              "aria-placeholder",
            ),
      };

      await target.fill(
        caption,
        {
          force: true,
        },
      );

      await page.waitForTimeout(
        1200,
      );

      const after = {
        innerText:
          await target
            .innerText()
            .catch(() => ""),
        textContent:
          await target
            .textContent()
            .catch(() => ""),
        html:
          await target
            .innerHTML()
            .catch(() => ""),
      };

      const screenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 70,
          fullPage: false,
        });

      response.json({
        success:
          after.innerText.includes(
            caption,
          ) ||
          (
            after.textContent || ""
          ).includes(
            caption,
          ),
        strategy:
          "playwright-contenteditable-fill",
        editorCount:
          count,
        visibleEditorCount:
          visibleEditors.length,
        before,
        after,
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
        },
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to test Facebook caption input.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/debug-editor",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    try {
      const page =
        await getPreferredFacebookPage(
          session.context,
        );

      const dialogs =
        page.locator(
          '[role="dialog"]',
        );

      const dialogCount =
        await dialogs
          .count()
          .catch(() => 0);

      const dialogSummaries = [];

      for (
        let index = 0;
        index < dialogCount;
        index += 1
      ) {
        const dialog =
          dialogs.nth(index);

        const visible =
          await dialog
            .isVisible()
            .catch(() => false);

        if (!visible) {
          continue;
        }

        dialogSummaries.push({
          index,
          text:
            (
              await dialog
                .innerText()
                .catch(() => "")
            )
              .replace(
                /\s+/g,
                " ",
              )
              .trim()
              .slice(
                0,
                1500,
              ),
          ariaLabel:
            await dialog
              .getAttribute(
                "aria-label",
              )
              .catch(() => null),
        });
      }

      const editors =
        await page.locator(
          '[contenteditable="true"], [role="textbox"]',
        ).evaluateAll(
          (elements) =>
            elements.map(
              (
                element,
                index,
              ) => {
                const html =
                  element as HTMLElement;

                const style =
                  window.getComputedStyle(
                    html,
                  );

                const rect =
                  html.getBoundingClientRect();

                const attributes:
                  Record<
                    string,
                    string
                  > = {};

                for (
                  const attribute
                  of Array.from(
                    html.attributes,
                  )
                ) {
                  attributes[
                    attribute.name
                  ] =
                    attribute.value;
                }

                return {
                  index,
                  tag:
                    html.tagName
                      .toLowerCase(),
                  visible:
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden" &&
                    rect.width > 0 &&
                    rect.height > 0,
                  role:
                    html.getAttribute(
                      "role",
                    ),
                  ariaLabel:
                    html.getAttribute(
                      "aria-label",
                    ),
                  ariaPlaceholder:
                    html.getAttribute(
                      "aria-placeholder",
                    ),
                  placeholder:
                    html.getAttribute(
                      "placeholder",
                    ),
                  contentEditable:
                    html.getAttribute(
                      "contenteditable",
                    ),
                  lexicalEditor:
                    html.getAttribute(
                      "data-lexical-editor",
                    ),
                  offsetKey:
                    html.getAttribute(
                      "data-offset-key",
                    ),
                  innerText:
                    (
                      html.innerText ||
                      ""
                    )
                      .replace(
                        /\s+/g,
                        " ",
                      )
                      .trim()
                      .slice(
                        0,
                        1000,
                      ),
                  textContent:
                    (
                      html.textContent ||
                      ""
                    )
                      .replace(
                        /\s+/g,
                        " ",
                      )
                      .trim()
                      .slice(
                        0,
                        1000,
                      ),
                  rect: {
                    x:
                      Math.round(
                        rect.x,
                      ),
                    y:
                      Math.round(
                        rect.y,
                      ),
                    width:
                      Math.round(
                        rect.width,
                      ),
                    height:
                      Math.round(
                        rect.height,
                      ),
                  },
                  attributes,
                  outerHTML:
                    html.outerHTML
                      .slice(
                        0,
                        4000,
                      ),
                };
              },
            ),
        );

      const screenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 65,
          fullPage: false,
        });

      response.json({
        success: true,
        page: {
          title:
            await page.title(),
          url:
            page.url(),
        },
        dialogs:
          dialogSummaries,
        editors,
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
        },
        inspectedAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to inspect Facebook editor.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/publish-post",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(profileKey);

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    const input =
      request.body as {
        confirmation?: string;
      };

    if (
      input.confirmation !==
      "PUBLISH"
    ) {
      response.status(400).json({
        success: false,
        message:
          'Explicit confirmation "PUBLISH" is required.',
      });
      return;
    }

    type WorkerExecutionTraceStep = {
      stepKey: string;
      stepName: string;
      stepOrder: number;
      status:
        | "SUCCESS"
        | "FAILED"
        | "SKIPPED";
      startedAt: string;
      completedAt: string;
      durationMs: number;
      metadata?: Record<
        string,
        unknown
      >;
      errorMessage?: string | null;
      screenshotPath?: string | null;
    };

    const executionTrace:
      WorkerExecutionTraceStep[] = [];

    let facebookPublishNetworkCapture:
      ReturnType<typeof startFacebookPublishNetworkCapture> | null = null;

    const completeTraceStep = (
      input: {
        stepKey: string;
        stepName: string;
        stepOrder: number;
        startedAtMs: number;
        status?:
          | "SUCCESS"
          | "FAILED"
          | "SKIPPED";
        metadata?: Record<
          string,
          unknown
        >;
        errorMessage?: string | null;
        screenshotPath?: string | null;
      },
    ) => {
      const completedAtMs =
        Date.now();

      executionTrace.push({
        stepKey:
          input.stepKey,
        stepName:
          input.stepName,
        stepOrder:
          input.stepOrder,
        status:
          input.status ||
          "SUCCESS",
        startedAt:
          new Date(
            input.startedAtMs,
          ).toISOString(),
        completedAt:
          new Date(
            completedAtMs,
          ).toISOString(),
        durationMs:
          Math.max(
            0,
            completedAtMs -
              input.startedAtMs,
          ),
        metadata:
          input.metadata,
        errorMessage:
          input.errorMessage ||
          null,
        screenshotPath:
          input.screenshotPath ||
          null,
      });
    };

    try {
      const page =
        await getPreferredFacebookPage(
          session.context,
        );

      if (!page) {
        throw new Error(
          "No active browser page was found.",
        );
      }

      const verifyDraftStartedAt =
        Date.now();

      const dialogs =
        page.locator(
          '[role="dialog"]',
        );

      const dialogCount =
        await dialogs
          .count()
          .catch(() => 0);

      let composer:
        import("playwright-core").Locator
        | null = null;

      for (
        let index =
          dialogCount - 1;
        index >= 0;
        index -= 1
      ) {
        const candidate =
          dialogs.nth(index);

        if (
          !await candidate
            .isVisible()
            .catch(() => false)
        ) {
          continue;
        }

        const editorCount =
          await candidate
            .locator(
              '[contenteditable="true"][role="textbox"]',
            )
            .count()
            .catch(() => 0);

        const text =
          await candidate
            .innerText()
            .catch(() => "");

        if (
          editorCount > 0 &&
          /create post/i.test(text)
        ) {
          composer =
            candidate;
          break;
        }
      }

      if (!composer) {
        throw new Error(
          "No prepared Facebook draft was found.",
        );
      }

      const editor =
        composer.locator(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
        ).last();

      const rawCaption =
        await editor
          .innerText()
          .catch(() => "");

      const caption =
        rawCaption
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const imageCount = await composer
        .locator("img")
        .count()
        .catch(() => 0);
      const mediaPreviewCount =
        await countFacebookComposerImagePreviews(composer);
      const expectedMediaCount = session.preparedFacebookMediaCount;

      if (!caption && mediaPreviewCount === 0) {
        throw new Error("The Facebook draft is empty.");
      }

      if (expectedMediaCount > 0 && mediaPreviewCount < expectedMediaCount) {
        throw new Error(
          [
            "Facebook draft media verification failed before publishing.",
            `Expected ${expectedMediaCount} image(s),`,
            `found ${mediaPreviewCount}.`,
          ].join(" "),
        );
      }

      completeTraceStep({
        stepKey:
          "VERIFY_DRAFT",
        stepName:
          "Verify prepared Facebook draft",
        stepOrder:
          1,
        startedAtMs:
          verifyDraftStartedAt,
        metadata: {
          captionLength:
            caption.length,
          imageCount,
          mediaPreviewCount,
          expectedMediaCount,
          composerFound: true,
        },
      });

      const verifyPublishButtonStartedAt =
        Date.now();

      let postButton:
        import("playwright-core").Locator
        | null = null;

      let publishButtonVisible =
        false;

      let advancedViaNext =
        false;

      for (
        let attempt = 0;
        attempt < 20 && !postButton;
        attempt += 1
      ) {
        const scopes = [
          composer,
          page.locator("body"),
        ];

        for (const scope of scopes) {
          const candidates =
            scope.getByRole(
              "button",
              {
                name: /^(post|publish)(?: now)?$/i,
              },
            );

          const candidateCount =
            await candidates
              .count()
              .catch(() => 0);

          for (
            let index =
              candidateCount - 1;
            index >= 0;
            index -= 1
          ) {
            const candidate =
              candidates.nth(index);

            if (
              !await candidate
                .isVisible()
                .catch(() => false)
            ) {
              continue;
            }

            publishButtonVisible =
              true;

            if (
              await candidate
                .isEnabled()
                .catch(() => false)
            ) {
              postButton =
                candidate;
              break;
            }
          }

          if (postButton) {
            break;
          }
        }

        if (
          !postButton &&
          !advancedViaNext
        ) {
          const nextCandidates =
            composer.getByRole(
              "button",
              {
                name: /^Next$/i,
              },
            );

          const nextCandidateCount =
            await nextCandidates
              .count()
              .catch(() => 0);

          for (
            let index =
              nextCandidateCount - 1;
            index >= 0;
            index -= 1
          ) {
            const candidate =
              nextCandidates.nth(index);

            if (
              !await candidate
                .isVisible()
                .catch(() => false) ||
              !await candidate
                .isEnabled()
                .catch(() => false)
            ) {
              continue;
            }

            await candidate.click({
              timeout: 10000,
            });

            advancedViaNext =
              true;

            await page.waitForTimeout(
              700,
            );

            break;
          }
        }

        if (!postButton) {
          await page.waitForTimeout(
            300,
          );
        }
      }

      if (!postButton) {
        throw new Error(
          publishButtonVisible
            ? "Facebook Post button is disabled."
            : "Facebook Post button was not found.",
        );
      }

      let publishMediaPreviewCount = mediaPreviewCount;
      let mediaRecheckSkippedAfterNext = false;

      if (
        expectedMediaCount > 0 &&
        !advancedViaNext
      ) {
        /*
         * When Facebook exposes Post directly in the composer, re-check the
         * visible media previews immediately before clicking it. The separate
         * Next flow intentionally replaces the composer with a final publish
         * step that no longer renders those previews, so VERIFY_DRAFT is the
         * authoritative media check for that path.
         */
        const visiblePublishDialogs =
          page.locator('[role="dialog"]:visible');

        publishMediaPreviewCount =
          await countFacebookComposerImagePreviews(visiblePublishDialogs);

        if (publishMediaPreviewCount < expectedMediaCount) {
          throw new Error(
            [
              "Facebook draft media disappeared before the final Post action.",
              `Expected ${expectedMediaCount} image(s),`,
              `found ${publishMediaPreviewCount}.`,
            ].join(" "),
          );
        }
      } else if (
        expectedMediaCount > 0 &&
        advancedViaNext
      ) {
        mediaRecheckSkippedAfterNext = true;
      }

      completeTraceStep({
        stepKey:
          "VERIFY_PUBLISH_BUTTON",
        stepName:
          "Verify Facebook Post button",
        stepOrder:
          2,
        startedAtMs:
          verifyPublishButtonStartedAt,
        metadata: {
          visible:
            true,
          enabled:
            true,
          advancedViaNext,
          expectedMediaCount,
          publishMediaPreviewCount,
          mediaRecheckSkippedAfterNext,
        },
      });

      const captureBeforeStartedAt =
        Date.now();

      const beforeScreenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 65,
          fullPage: false,
        });


      const savedBeforeScreenshot =
        await saveBrowserScreenshot({
          profileKey,
          action:
            "publish-before",
          buffer:
            beforeScreenshot,
        });

      completeTraceStep({
        stepKey:
          "CAPTURE_BEFORE",
        stepName:
          "Capture pre-publish screenshot",
        stepOrder:
          3,
        startedAtMs:
          captureBeforeStartedAt,
        metadata: {
          screenshotPath:
            savedBeforeScreenshot.absolutePath,
        },
        screenshotPath:
          savedBeforeScreenshot.absolutePath,
      });

      const clickPublishStartedAt =
        Date.now();

      const publishButtonDiagnostics =
        await postButton
          .evaluate((element) => ({
            tagName: element.tagName,
            text: (element.textContent || "").replace(/\s+/g, " ").trim(),
            ariaLabel: element.getAttribute("aria-label"),
            testId: element.getAttribute("data-testid"),
            disabled:
              element instanceof HTMLButtonElement
                ? element.disabled
                : element.getAttribute("aria-disabled") === "true",
          }))
          .catch(() => null);

      facebookPublishNetworkCapture =
        startFacebookPublishNetworkCapture(page);

      await postButton.click({
        timeout: 10000,
      });

      completeTraceStep({
        stepKey:
          "CLICK_PUBLISH",
        stepName:
          "Click Facebook Post button",
        stepOrder:
          4,
        metadata: {
          publishButtonDiagnostics,
        },
        startedAtMs:
          clickPublishStartedAt,
      });

      let composerStillVisible =
        true;

      let alertTexts:
        string[] = [];

      let pageText =
        "";

      let successSignal =
        false;

      let errorSignal =
        false;

      let successSignalFirstSeenAt:
        number | null = null;

      const successConfirmationGraceMs =
        1200;

      const verificationStartedAt =
        Date.now();

      const verificationTimeoutMs =
        30000;

      while (
        Date.now() -
          verificationStartedAt <
        verificationTimeoutMs
      ) {
        composerStillVisible =
          await composer
            .isVisible()
            .catch(() => false);

        const visibleAlerts =
          page.locator(
            '[role="alert"]:visible, [role="status"]:visible',
          );

        const alertCount =
          await visibleAlerts
            .count()
            .catch(() => 0);

        alertTexts = [];

        for (
          let index = 0;
          index < alertCount;
          index += 1
        ) {
          const alertText =
            (
              await visibleAlerts
                .nth(index)
                .innerText()
                .catch(() => "")
            )
              .replace(
                /\s+/g,
                " ",
              )
              .trim();

          if (alertText) {
            alertTexts.push(
              alertText.slice(
                0,
                500,
              ),
            );
          }
        }

        pageText =
          (
            await page
              .locator("body")
              .innerText()
              .catch(() => "")
          )
            .replace(
              /\s+/g,
              " ",
            )
            .trim();

        const combinedFeedback =
          [
            ...alertTexts,
            pageText.slice(
              0,
              12000,
            ),
          ].join(" ");

        successSignal =
          hasFacebookPublishSuccessSignal(
            combinedFeedback,
          );

        errorSignal =
          hasFacebookPublishErrorSignal(
            combinedFeedback,
          );

        if (errorSignal) {
          break;
        }

        if (!composerStillVisible) {
          await page.waitForTimeout(
            3000,
          );
          break;
        }

        if (successSignal) {
          if (
            successSignalFirstSeenAt ===
            null
          ) {
            successSignalFirstSeenAt =
              Date.now();
          }

          if (
            Date.now() -
              successSignalFirstSeenAt >=
            successConfirmationGraceMs
          ) {
            break;
          }
        } else {
          successSignalFirstSeenAt =
            null;
        }

        await page.waitForTimeout(
          400,
        );
      }

      let postReference =
        null;

      if (!errorSignal && !successSignal) {
        postReference =
          await findFacebookPublishedPostReference(
            page,
            rawCaption,
            12000,
          );
      }

      const confirmationRefreshAttempted =
        shouldRefreshFacebookPublishConfirmation({
          errorSignal,
          successSignal,
          composerStillVisible,
          postReferenceFound:
            Boolean(postReference),
        });

      if (confirmationRefreshAttempted) {
        try {
          await page.reload({
            waitUntil:
              "domcontentloaded",
            timeout: 15000,
          });
          await page.waitForTimeout(1500);
        } catch (error) {
          console.warn(
            "[facebook/publish-confirmation-refresh-failed]",
            {
              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          );
        }

        composerStillVisible =
          await composer
            .isVisible()
            .catch(() => false);

        const refreshedAlerts =
          page.locator(
            '[role="alert"]:visible, [role="status"]:visible',
          );
        const refreshedAlertCount =
          await refreshedAlerts
            .count()
            .catch(() => 0);

        alertTexts = [];

        for (
          let index = 0;
          index < refreshedAlertCount;
          index += 1
        ) {
          const alertText =
            (
              await refreshedAlerts
                .nth(index)
                .innerText()
                .catch(() => "")
            )
              .replace(/\s+/g, " ")
              .trim();

          if (alertText) {
            alertTexts.push(
              alertText.slice(0, 500),
            );
          }
        }

        pageText =
          (
            await page
              .locator("body")
              .innerText()
              .catch(() => "")
          )
            .replace(/\s+/g, " ")
            .trim();

        const refreshedFeedback =
          [
            ...alertTexts,
            pageText.slice(0, 12000),
          ].join(" ");

        successSignal =
          hasFacebookPublishSuccessSignal(
            refreshedFeedback,
          );
        errorSignal =
          hasFacebookPublishErrorSignal(
            refreshedFeedback,
          );

        if (!errorSignal && !successSignal) {
          postReference =
            await findFacebookPublishedPostReference(
              page,
              rawCaption,
              12000,
            );
        }
      }

      const publishNetworkEvents =
        await facebookPublishNetworkCapture?.stop() || [];
      const networkErrorSignal =
        hasFacebookPublishNetworkError(publishNetworkEvents);

      errorSignal =
        errorSignal || networkErrorSignal;

      if (
        !errorSignal &&
        !successSignal &&
        composerStillVisible
      ) {
        postReference =
          postReference ??
          await findFacebookPublishedPostReference(
            page,
            rawCaption,
          );
      }

      const verificationStatus =
        resolveFacebookPublishVerificationStatus({
          errorSignal,
          successSignal,
          composerStillVisible,
          postReferenceFound:
            Boolean(postReference),
          allowComposerClosed:
            !confirmationRefreshAttempted,
        });

      const published =
        resolveFacebookPublishedFlag({
          errorSignal,
          successSignal,
          composerStillVisible,
          postReferenceFound:
            Boolean(postReference),
          allowComposerClosed:
            !confirmationRefreshAttempted,
        });

      console.log(
        "[facebook/publish-confirmation]",
        {
          url:
            page.url(),
          verificationStatus,
          published,
          composerStillVisible,
          successSignal,
          errorSignal,
          networkErrorSignal,
          postReferenceFound:
            Boolean(postReference),
          confirmationRefreshAttempted,
          alertCount:
            alertTexts.length,
          alertTexts,
          publishNetworkEvents,
        },
      );

      completeTraceStep({
        stepKey:
          "WAIT_CONFIRMATION",
        stepName:
          "Wait for Facebook publish confirmation",
        stepOrder:
          5,
        startedAtMs:
          verificationStartedAt,
        status:
          errorSignal
            ? "FAILED"
            : verificationStatus ===
                "UNCONFIRMED"
              ? "FAILED"
              : "SUCCESS",
        metadata: {
          verificationStatus,
          composerClosed:
            !composerStillVisible,
          successSignal,
          errorSignal,
          postReferenceFound:
            Boolean(postReference),
          confirmationRefreshAttempted,
          alertTexts,
          publishNetworkEvents,
          timeoutMs:
            verificationTimeoutMs,
        },
        errorMessage:
          errorSignal
            ? "Facebook returned a publish error signal."
            : verificationStatus ===
                "UNCONFIRMED"
              ? "Facebook publishing could not be confirmed."
              : null,
      });

      const resolvePostReferenceStartedAt =
        Date.now();

      postReference =
        postReference ??
        (
          verificationStatus ===
              "CONFIRMED" ||
            verificationStatus ===
              "COMPOSER_CLOSED"
            ? await findFacebookPublishedPostReference(
                page,
                rawCaption,
              )
            : null
        );

      completeTraceStep({
        stepKey:
          "RESOLVE_POST_REFERENCE",
        stepName:
          "Resolve published Facebook post reference",
        stepOrder:
          6,
        startedAtMs:
          resolvePostReferenceStartedAt,
        status:
          postReference
            ? "SUCCESS"
            : "SKIPPED",
        metadata: {
          resolved:
            Boolean(postReference),
          externalPostId:
            postReference
              ?.externalPostId ||
            null,
          postUrl:
            postReference
              ?.postUrl || null,
          matchedBy:
            postReference
              ?.matchedBy || null,
        },
      });

      const captureAfterStartedAt =
        Date.now();

      const afterScreenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 65,
          fullPage: false,
        });


      const savedAfterScreenshot =
        await saveBrowserScreenshot({
          profileKey,
          action:
            "publish-after",
          buffer:
            afterScreenshot,
        });

      completeTraceStep({
        stepKey:
          "CAPTURE_AFTER",
        stepName:
          "Capture post-publish screenshot",
        stepOrder:
          7,
        startedAtMs:
          captureAfterStartedAt,
        metadata: {
          screenshotPath:
            savedAfterScreenshot.absolutePath,
        },
        screenshotPath:
          savedAfterScreenshot.absolutePath,
      });

      const publishResultStartedAt =
        Date.now();

      completeTraceStep({
        stepKey:
          "PUBLISH_RESULT",
        stepName:
          "Finalize Facebook publish result",
        stepOrder:
          8,
        startedAtMs:
          publishResultStartedAt,
        status:
          verificationStatus ===
            "FAILED" ||
          verificationStatus ===
            "UNCONFIRMED"
            ? "FAILED"
            : "SUCCESS",
        metadata: {
          published,
          verificationStatus,
          composerClosed:
            !composerStillVisible,
        },
        errorMessage:
          verificationStatus ===
            "FAILED"
            ? "Facebook publishing failed."
            : verificationStatus ===
                "UNCONFIRMED"
              ? "Facebook publishing remained unconfirmed."
              : null,
      });

      response.json({
        success:
          verificationStatus ===
            "CONFIRMED" ||
          verificationStatus ===
            "COMPOSER_CLOSED",
        executionTrace,
        published,
        browserProfileKey:
          session.browserProfileKey,
        postId:
          postReference
            ?.externalPostId || null,
        facebookPostId:
          postReference
            ?.facebookPostId || null,
        postUrl:
          postReference
            ?.postUrl || null,
        captionLength:
          caption.length,
        imageCount,
        mediaPreviewCount: publishMediaPreviewCount,
        expectedMediaCount,
        composerClosed: !composerStillVisible,
        verification: {
          status:
            verificationStatus,
          waitedMs:
            Date.now() -
            verificationStartedAt,
          timeoutMs:
            verificationTimeoutMs,
          composerClosed:
            !composerStillVisible,
          successSignal,
          errorSignal,
          alertTexts,
          publishNetworkEvents,
        },
        screenshots: {
          before: {
            mimeType:
              "image/jpeg",
            base64:
              beforeScreenshot.toString(
                "base64",
              ),
            absolutePath:
              savedBeforeScreenshot.absolutePath,
            relativePath:
              savedBeforeScreenshot.relativePath,
            filename:
              savedBeforeScreenshot.filename,
          },
          after: {
            mimeType:
              "image/jpeg",
            base64:
              afterScreenshot.toString(
                "base64",
              ),
            absolutePath:
              savedAfterScreenshot.absolutePath,
            relativePath:
              savedAfterScreenshot.relativePath,
            filename:
              savedAfterScreenshot.filename,
          },
        },
        publishedAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      await facebookPublishNetworkCapture?.stop().catch(() => undefined);
      response.status(400).json({
        success: false,
        published: false,
        executionTrace,
        message:
          error instanceof Error
            ? error.message
            : "Unable to publish Facebook post.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/discard-post",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(profileKey);

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    type WorkerExecutionTraceStep = {
      stepKey: string;
      stepName: string;
      stepOrder: number;
      status:
        | "SUCCESS"
        | "FAILED"
        | "SKIPPED";
      startedAt: string;
      completedAt: string;
      durationMs: number;
      metadata?: Record<
        string,
        unknown
      >;
      errorMessage?: string | null;
      screenshotPath?: string | null;
    };

    const executionTrace:
      WorkerExecutionTraceStep[] = [];

    const completeTraceStep = (
      input: {
        stepKey: string;
        stepName: string;
        stepOrder: number;
        startedAtMs: number;
        status?:
          | "SUCCESS"
          | "FAILED"
          | "SKIPPED";
        metadata?: Record<
          string,
          unknown
        >;
        errorMessage?: string | null;
        screenshotPath?: string | null;
      },
    ) => {
      const completedAtMs =
        Date.now();

      executionTrace.push({
        stepKey:
          input.stepKey,
        stepName:
          input.stepName,
        stepOrder:
          input.stepOrder,
        status:
          input.status ||
          "SUCCESS",
        startedAt:
          new Date(
            input.startedAtMs,
          ).toISOString(),
        completedAt:
          new Date(
            completedAtMs,
          ).toISOString(),
        durationMs:
          Math.max(
            0,
            completedAtMs -
              input.startedAtMs,
          ),
        metadata:
          input.metadata,
        errorMessage:
          input.errorMessage ||
          null,
        screenshotPath:
          input.screenshotPath ||
          null,
      });
    };

    try {
      const page =
        await getPreferredFacebookPage(
          session.context,
        );

      if (!page) {
        throw new Error(
          "No active browser page was found.",
        );
      }

      const verifyDraftStartedAt =
        Date.now();

      const dialogs =
        page.locator(
          '[role="dialog"]',
        );

      const count =
        await dialogs
          .count()
          .catch(() => 0);

      let composer:
        import("playwright-core").Locator
        | null = null;

      for (
        let index =
          count - 1;
        index >= 0;
        index -= 1
      ) {
        const candidate =
          dialogs.nth(index);

        if (
          !await candidate
            .isVisible()
            .catch(() => false)
        ) {
          continue;
        }

        const editorCount =
          await candidate
            .locator(
              '[contenteditable="true"][role="textbox"]',
            )
            .count()
            .catch(() => 0);

        const dialogText =
          await candidate
            .innerText()
            .catch(() => "");

        if (
          editorCount > 0 &&
          /create post/i.test(
            dialogText,
          )
        ) {
          composer =
            candidate;
          break;
        }
      }

      if (!composer) {
        completeTraceStep({
          stepKey:
            "VERIFY_DRAFT",
          stepName:
            "Verify open Facebook draft",
          stepOrder:
            1,
          startedAtMs:
            verifyDraftStartedAt,
          status:
            "SKIPPED",
          metadata: {
            composerFound:
              false,
            alreadyClosed:
              true,
          },
          errorMessage:
            "No Facebook draft is currently open.",
        });

        response.json({
          success: true,
          discarded: false,
          alreadyClosed: true,
          executionTrace,
          message:
            "No Facebook draft is currently open.",
        });
        return;
      }

      completeTraceStep({
        stepKey:
          "VERIFY_DRAFT",
        stepName:
          "Verify open Facebook draft",
        stepOrder:
          1,
        startedAtMs:
          verifyDraftStartedAt,
        metadata: {
          composerFound:
            true,
        },
      });

      const clickCloseStartedAt =
        Date.now();

      const closeCandidates = [
        composer.getByRole(
          "button",
          {
            name:
              /^Close$/i,
          },
        ),
        composer.locator(
          '[aria-label="Close"]',
        ),
        composer.locator(
          '[role="button"][aria-label*="Close" i]',
        ),
      ];

      let closed =
        false;

      for (
        const candidate
        of closeCandidates
      ) {
        const button =
          candidate.first();

        if (
          await button
            .isVisible()
            .catch(() => false)
        ) {
          await button.click({
            force: true,
            timeout: 5000,
          });

          closed =
            true;
          break;
        }
      }

      if (!closed) {
        throw new Error(
          "Facebook draft close button was not found.",
        );
      }

      completeTraceStep({
        stepKey:
          "CLICK_CLOSE",
        stepName:
          "Close Facebook composer",
        stepOrder:
          2,
        startedAtMs:
          clickCloseStartedAt,
        metadata: {
          closeButtonClicked:
            true,
        },
      });

      const confirmDiscardStartedAt =
        Date.now();

      await page.waitForTimeout(
        700,
      );

      const discardCandidates = [
        page.getByRole(
          "button",
          {
            name:
              /^Delete draft$/i,
          },
        ),
        page.getByRole(
          "button",
          {
            name:
              /^Discard$/i,
          },
        ),
        page.locator(
          '[role="button"]',
        ).filter({
          hasText:
            /delete draft|discard/i,
        }),
        page.getByText(
          /delete draft|discard/i,
          {
            exact: true,
          },
        ),
      ];

      let discardConfirmed =
        false;

      for (
        const candidate
        of discardCandidates
      ) {
        const button =
          candidate.last();

        if (
          await button
            .isVisible()
            .catch(() => false)
        ) {
          await button.click({
            force: true,
            timeout: 5000,
          });

          discardConfirmed =
            true;

          await page.waitForTimeout(
            900,
          );

          break;
        }
      }

      if (!discardConfirmed) {
        throw new Error(
          "Facebook Delete draft confirmation button was not found.",
        );
      }

      completeTraceStep({
        stepKey:
          "CONFIRM_DISCARD",
        stepName:
          "Confirm Facebook draft discard",
        stepOrder:
          3,
        startedAtMs:
          confirmDiscardStartedAt,
        metadata: {
          discardConfirmed,
        },
      });

      const verifyDiscardedStartedAt =
        Date.now();

      const composerStillVisible =
        await composer
          .isVisible()
          .catch(() => false);

      completeTraceStep({
        stepKey:
          "VERIFY_DISCARDED",
        stepName:
          "Verify Facebook draft was discarded",
        stepOrder:
          4,
        startedAtMs:
          verifyDiscardedStartedAt,
        status:
          composerStillVisible
            ? "FAILED"
            : "SUCCESS",
        metadata: {
          composerStillVisible,
          discardConfirmed,
        },
        errorMessage:
          composerStillVisible
            ? "Facebook composer remained visible after discard."
            : null,
      });

      if (composerStillVisible) {
        throw new Error(
          "Facebook composer remained visible after discard.",
        );
      }

      const captureResultStartedAt =
        Date.now();

      const screenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 65,
          fullPage: false,
        });


      const savedDiscardScreenshot =
        await saveBrowserScreenshot({
          profileKey,
          action:
            "discard",
          buffer:
            screenshot,
        });

      completeTraceStep({
        stepKey:
          "CAPTURE_RESULT",
        stepName:
          "Capture discarded draft result",
        stepOrder:
          5,
        startedAtMs:
          captureResultStartedAt,
        metadata: {
          screenshotPath:
            savedDiscardScreenshot.absolutePath,
        },
        screenshotPath:
          savedDiscardScreenshot.absolutePath,
      });

      response.json({
        success: true,
        discarded: true,
        executionTrace,
        discardConfirmed,
        browserProfileKey:
          session.browserProfileKey,
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
          absolutePath:
            savedDiscardScreenshot.absolutePath,
          relativePath:
            savedDiscardScreenshot.relativePath,
          filename:
            savedDiscardScreenshot.filename,
        },
        discardedAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        discarded: false,
        executionTrace,
        message:
          error instanceof Error
            ? error.message
            : "Unable to discard Facebook draft.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/prepare-post",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    session.preparedFacebookMediaCount = 0;

    const input = request.body as {
      caption?: string;
      imagePath?: string | null;
      imageUrl?: string | null;
      imageUrls?: string[] | null;
      targetUrl?: string | null;
    };

    const caption =
      input.caption?.trim();

    const imagePath = input.imagePath?.trim() || null;

    const imageUrls = Array.from(
      new Set(
        [
          ...(Array.isArray(input.imageUrls) ? input.imageUrls : []),
          input.imageUrl,
        ]
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      ),
    );

    if (imageUrls.length > 10) {
      response.status(400).json({
        success: false,
        message: "Facebook posts support at most 10 images.",
      });
      return;
    }

    const imagePaths = imagePath ? [imagePath] : [];

    const targetUrl =
      input.targetUrl?.trim() ||
      "https://www.facebook.com/";

    let parsedTarget:
      URL;

    try {
      parsedTarget =
        new URL(
          targetUrl,
        );
    } catch {
      response.status(400).json({
        success: false,
        message:
          "Invalid Facebook Page target URL.",
      });
      return;
    }

    const targetHostname =
      parsedTarget.hostname
        .toLowerCase();

    if (
      targetHostname !==
        "facebook.com" &&
      targetHostname !==
        "www.facebook.com" &&
      !targetHostname.endsWith(
        ".facebook.com",
      )
    ) {
      response.status(400).json({
        success: false,
        message:
          "Facebook target must use facebook.com.",
      });
      return;
    }

    if (!caption) {
      response.status(400).json({
        success: false,
        message:
          "Caption is required.",
      });
      return;
    }

    if (caption.length > 10000) {
      response.status(400).json({
        success: false,
        message:
          "Caption is too long.",
      });
      return;
    }

    let stagedImageCleanup:
      (() => Promise<void>) | null = null;

    if (imagePaths.length === 0 && imageUrls.length > 0) {
      const parsedImageUrls: URL[] = [];

      for (const imageUrl of imageUrls) {
        let parsedImageUrl: URL;

        try {
          parsedImageUrl = new URL(imageUrl);
        } catch {
          response.status(400).json({
            success: false,
            message: "Invalid image URL.",
          });
          return;
        }

        if (!["http:", "https:"].includes(parsedImageUrl.protocol)) {
          response.status(400).json({
            success: false,
            message: "Image URL must use http or https.",
          });
          return;
        }

        parsedImageUrls.push(parsedImageUrl);
      }

      const stagingDirectory = await mkdtemp(
        path.join(tmpdir(), "atlas-facebook-images-"),
      );

      stagedImageCleanup = async () => {
        await rm(
          stagingDirectory,
          {
            recursive: true,
            force: true,
          },
        );
      };

      for (let index = 0; index < imageUrls.length; index += 1) {
        const imageUrl = imageUrls[index];
        const parsedImageUrl = parsedImageUrls[index];
        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
          await stagedImageCleanup();
          response.status(400).json({
            success: false,
            message: `Unable to download image ${index + 1} (HTTP ${imageResponse.status}).`,
          });
          return;
        }

        const contentType =
          imageResponse.headers
            .get("content-type")
            ?.split(";", 1)[0]
            .trim()
            .toLowerCase() || "";

        if (contentType && !contentType.startsWith("image/")) {
          await stagedImageCleanup();
          response.status(400).json({
            success: false,
            message: `Remote media ${index + 1} is not an image.`,
          });
          return;
        }

        const imageBytes = Buffer.from(await imageResponse.arrayBuffer());

        if (imageBytes.length === 0) {
          await stagedImageCleanup();
          response.status(400).json({
            success: false,
            message: `Remote image ${index + 1} is empty.`,
          });
          return;
        }

        const extensionByType: Record<string, string> = {
          "image/jpeg": ".jpg",
          "image/png": ".png",
          "image/webp": ".webp",
        };
        const extensionFromUrl = path
          .extname(parsedImageUrl.pathname)
          .toLowerCase();
        const extension = [".jpg", ".jpeg", ".png", ".webp"].includes(
          extensionFromUrl,
        )
          ? extensionFromUrl
          : extensionByType[contentType] || ".jpg";
        const stagedImagePath = path.join(
          stagingDirectory,
          `upload-${index + 1}${extension}`,
        );

        await writeFile(stagedImagePath, imageBytes);
        imagePaths.push(stagedImagePath);
      }
    }

    for (const imagePathToValidate of imagePaths) {
      const extension = path.extname(imagePathToValidate).toLowerCase();

      if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
        response.status(400).json({
          success: false,
          message:
            "Image must be JPG, JPEG, PNG or WEBP.",
        });
        return;
      }

      try {
        await access(imagePathToValidate);
      } catch {
        await stagedImageCleanup?.();
        response.status(400).json({
          success: false,
          message:
            "Image file was not found.",
        });
        return;
      }
    }

    type WorkerExecutionTraceStep = {
      stepKey: string;
      stepName: string;
      stepOrder: number;
      status:
        | "SUCCESS"
        | "FAILED"
        | "SKIPPED";
      startedAt: string;
      completedAt: string;
      durationMs: number;
      metadata?: Record<
        string,
        unknown
      >;
      errorMessage?: string | null;
    };

    const executionTrace:
      WorkerExecutionTraceStep[] = [];

    const completeTraceStep = (
      input: {
        stepKey: string;
        stepName: string;
        stepOrder: number;
        startedAtMs: number;
        status?:
          | "SUCCESS"
          | "FAILED"
          | "SKIPPED";
        metadata?: Record<
          string,
          unknown
        >;
        errorMessage?: string | null;
      },
    ) => {
      const completedAtMs =
        Date.now();

      executionTrace.push({
        stepKey:
          input.stepKey,
        stepName:
          input.stepName,
        stepOrder:
          input.stepOrder,
        status:
          input.status ||
          "SUCCESS",
        startedAt:
          new Date(
            input.startedAtMs,
          ).toISOString(),
        completedAt:
          new Date(
            completedAtMs,
          ).toISOString(),
        durationMs:
          Math.max(
            0,
            completedAtMs -
              input.startedAtMs,
          ),
        metadata:
          input.metadata,
        errorMessage:
          input.errorMessage ||
          null,
      });
    };

    let automationPage:
      Page | null =
      null;

    try {
      /*
       * DEDICATED_FACEBOOK_AUTOMATION_PAGE_V2
       *
       * Always create a dedicated automation tab
       * inside the same persistent BrowserContext.
       *
       * This preserves the Facebook cookies/session
       * but prevents automation from depending on
       * whichever tab the user is currently viewing.
       */
      const page =
        await session.context.newPage();

      automationPage =
        page;

      const resetComposerStartedAt =
        Date.now();

      const composerReset =
        await resetFacebookComposer(
          page,
        );

      completeTraceStep({
        stepKey:
          "RESET_COMPOSER",
        stepName:
          "Reset existing composer",
        stepOrder:
          1,
        startedAtMs:
          resetComposerStartedAt,
        metadata: {
          reset:
            composerReset.reset,
        },
      });

      const openFacebookStartedAt =
        Date.now();

      /*
       * business.facebook.com and other Meta pages
       * also contain facebook.com in the hostname.
       * Composer automation requires the normal
       * Facebook home feed, so navigate explicitly.
       */
      await page.goto(
        targetUrl,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 30000,
        },
      );

      /*
       * FACEBOOK_PAGE_READY_WAIT_V1
       *
       * Facebook frequently returns from
       * domcontentloaded while the Page is still
       * displaying its loading skeleton.
       *
       * Wait for meaningful rendered content before
       * searching for the Composer.
       */
      const pageReadyStartedAt =
        Date.now();

      let pageReadyText =
        "";

      for (
        let attempt = 1;
        attempt <= 30;
        attempt += 1
      ) {
        pageReadyText =
          await page
            .locator("body")
            .innerText()
            .catch(() => "");

        const mainVisible =
          await page
            .locator('[role="main"]')
            .first()
            .isVisible()
            .catch(() => false);

        const readyState =
          await page
            .evaluate(
              () => document.readyState,
            )
            .catch(() => "");

        if (
          (
            readyState === "complete" ||
            readyState === "interactive"
          ) &&
          (
            pageReadyText.trim().length > 80 ||
            mainVisible
          )
        ) {
          break;
        }

        await page.waitForTimeout(
          1000,
        );
      }

      console.log(
        "[facebook/page-ready]",
        {
          url:
            page.url(),
          durationMs:
            Date.now() -
            pageReadyStartedAt,
          textLength:
            pageReadyText.trim().length,
        },
      );

      const pageText =
        await page
          .locator("body")
          .innerText({
            timeout: 10000,
          })
          .catch(() => "");

      const normalizedText =
        pageText.toLowerCase();

      const facebookLoginUrl =
        page
          .url()
          .toLowerCase()
          .includes(
            "/login",
          );

      const initialVisibleFacebookLoginForm =
        await page
          .locator(
            'input[name="email"]:visible, input[name="pass"]:visible, input[type="password"]:visible',
          )
          .count()
          .then((count) => count > 0)
          .catch(() => false);

      const visibleFacebookLoginText =
        await page
          .getByText(
            /log in to facebook/i,
          )
          .first()
          .isVisible()
          .catch(() => false);

      const hasPageSwitchPrompt =
        hasFacebookPageSwitchPrompt(
          normalizedText,
        );

      const hasFacebookLoginPage =
        facebookLoginUrl ||
        initialVisibleFacebookLoginForm ||
        visibleFacebookLoginText ||
        (
          normalizedText.includes(
            "email or phone number",
          ) &&
          normalizedText.includes(
            "password",
          ) &&
          normalizedText.includes(
            "log in",
          )
        );

      if (hasFacebookLoginPage && !hasPageSwitchPrompt) {
        response.status(400).json({
          success: false,
          loginRequired: true,
          message:
            "Facebook login is required.",
        });
        return;
      }

      completeTraceStep({
        stepKey:
          "OPEN_FACEBOOK",
        stepName:
          "Open Facebook",
        stepOrder:
          2,
        startedAtMs:
          openFacebookStartedAt,
        metadata: {
          url:
            page.url(),
          loginRequired:
            false,
        },
      });

      const closeOverlayCandidates = [
        page.getByRole(
          "button",
          {
            name:
              /close|not now|cancel/i,
          },
        ),
        page.locator(
          '[aria-label="Close"]',
        ),
      ];

      for (
        const closeCandidate
        of closeOverlayCandidates
      ) {
        const button =
          closeCandidate.first();

        if (
          await button
            .isVisible()
            .catch(() => false)
        ) {
          await button
            .click({
              timeout: 3000,
              force: true,
            })
            .catch(() => undefined);

          await page.waitForTimeout(
            400,
          );
        }
      }

      /*
       * FACEBOOK_PAGE_IDENTITY_SWITCH_V1
       *
       * A persistent session may show the Page identity on the home feed,
       * while a direct Page URL still presents Facebook's "Switch" or
       * "Switch now"
       * interstitial in the dedicated automation tab. Switch explicitly
       * before looking for the Page composer.
       */
      const getVisibleSwitchAction = async () => {
        const switchPageCandidates = [
          page.getByRole(
            "button",
            {
              name:
                facebookPageSwitchActionPattern,
            },
          ),
          page.getByRole(
            "link",
            {
              name:
                facebookPageSwitchActionPattern,
            },
          ),
          page.getByText(
            facebookPageSwitchActionPattern,
            {
              exact: true,
            },
          ),
        ];

        for (const candidateLocator of switchPageCandidates) {
          const candidate = candidateLocator.first();

          if (
            await candidate
              .isVisible()
              .catch(() => false)
          ) {
            return candidate;
          }
        }

        return null;
      };

      const pageIdentitySwitch =
        await ensureFacebookPageIdentitySwitch({
          inspectState: async () => ({
            bodyText:
              await page
                .locator("body")
                .innerText()
                .catch(() => ""),
            hasVisibleSwitchAction:
              Boolean(
                await getVisibleSwitchAction(),
              ),
          }),
          clickSwitchAction: async () => {
            const candidate =
              await getVisibleSwitchAction();

            if (!candidate) {
              return false;
            }

            return candidate
              .click({
                timeout: 5000,
                force: true,
              })
              .then(() => true)
              .catch(() => false);
          },
          waitForSettled: async () => {
            await page.waitForTimeout(2500);
            await page
              .waitForLoadState(
                "domcontentloaded",
                {
                  timeout: 5000,
                },
              )
              .catch(() => undefined);
          },
          maxAttempts: 3,
        });

      console.log(
        "[facebook/page-identity-switch]",
        {
          url:
            page.url(),
          required:
            pageIdentitySwitch.required,
          verified:
            pageIdentitySwitch.verified,
          attempts:
            pageIdentitySwitch.attempts,
          targetPageName:
            pageIdentitySwitch.targetPageName,
          reason:
            pageIdentitySwitch.reason,
        },
      );

      if (!pageIdentitySwitch.verified) {
        throw new Error(
          [
            "Facebook Page identity switch did not complete.",
            pageIdentitySwitch.targetPageName
              ? `Target Page: ${pageIdentitySwitch.targetPageName}.`
              : null,
            `Attempts: ${pageIdentitySwitch.attempts}.`,
            `Reason: ${pageIdentitySwitch.reason}.`,
            `URL: ${page.url()}.`,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }

      /*
       * FACEBOOK_LOGIN_RECHECK_AFTER_IDENTITY_SWITCH_V1
       *
       * Facebook can render a Page identity switch interstitial first and
       * only expose its login form after the switch interaction completes.
       * The initial page check intentionally allows that interstitial, so
       * re-check the live DOM here before entering composer retries.
       */
      const hasVisibleFacebookLoginForm =
        await page
          .locator(
            'input[name="email"]:visible, input[name="pass"]:visible, input[type="password"]:visible',
          )
          .count()
          .then((count) => count > 0)
          .catch(() => false);

      const postSwitchPageText =
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        )
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const postSwitchFacebookLoginPage =
        hasVisibleFacebookLoginForm ||
        postSwitchPageText.includes(
          "log in to facebook",
        ) ||
        (
          postSwitchPageText.includes(
            "email or phone number",
          ) &&
          postSwitchPageText.includes(
            "password",
          ) &&
          postSwitchPageText.includes(
            "log in",
          )
        );

      if (postSwitchFacebookLoginPage) {
        response.status(400).json({
          success: false,
          loginRequired: true,
          message:
            "Facebook login is required.",
        });
        return;
      }

      const openComposerStartedAt =
        Date.now();

      /*
       * FACEBOOK_PAGE_COMPOSER_TRIGGER_V1
       *
       * Personal profiles commonly use
       * "What's on your mind?" while Facebook Pages
       * commonly expose "Create post".
       */
      const composerTriggerPattern =
        /what'?s on your mind|create (?:a )?post|write (?:a )?post|post something|write something|share something|new post|你在想什麼|你在想什么|建立貼文|建立帖子|创建帖子|创建贴文|發佈貼文|发布帖子|发布贴文|發帖|发帖|寫點什麼|写点什么|apa yang (?:sedang )?anda fikirkan|cipta siaran|buat siaran|tulis siaran/i;

      /*
       * FACEBOOK_COMPOSER_TRIGGER_RETRY_V1
       *
       * Facebook Page UI is rendered asynchronously.
       * Retry Composer discovery for up to 30 seconds
       * instead of checking the DOM only once.
       */
      let composerOpened =
        false;

      let composerTriggerAttempt =
        0;

      const composerTriggerStartedAt =
        Date.now();

      for (
        let attempt = 1;
        attempt <= 30 &&
        !composerOpened;
        attempt += 1
      ) {
        composerTriggerAttempt =
          attempt;

        const composerTriggers = [
          page.getByRole(
            "button",
            {
              name:
                composerTriggerPattern,
            },
          ),

          page.getByRole(
            "link",
            {
              name:
                composerTriggerPattern,
            },
          ),

          page.getByRole(
            "textbox",
            {
              name:
                composerTriggerPattern,
            },
          ),

          page.locator(
            '[role="button"]',
          ).filter({
            hasText:
              composerTriggerPattern,
          }),

          page.locator(
            '[role="link"]',
          ).filter({
            hasText:
              composerTriggerPattern,
          }),

          page.getByText(
            composerTriggerPattern,
            {
              exact: false,
            },
          ),
        ];

        for (
          const trigger
          of composerTriggers
        ) {
          const count =
            await trigger
              .count()
              .catch(() => 0);

          for (
            let index = 0;
            index < count;
            index += 1
          ) {
            const candidate =
              trigger.nth(index);

            if (
              !await candidate
                .isVisible()
                .catch(() => false)
            ) {
              continue;
            }

            const clicked =
              await candidate
                .click({
                  timeout: 5000,
                  force: true,
                })
                .then(() => true)
                .catch(() => false);

            if (clicked) {
              /*
               * Facebook exposes several similarly named composer surfaces
               * on a Page. A successful DOM click is not enough: keep trying
               * candidates until the actual Create post dialog is visible.
               */
              const dialogAfterClick =
                await findFacebookCreatePostDialog(
                  page,
                  1800,
                ).catch(() => null);

              if (dialogAfterClick) {
                composerOpened =
                  true;
                break;
              }
            }

            const domClicked =
              await candidate
                .evaluate(
                  (element) => {
                    (
                      element as HTMLElement
                    ).click();
                  },
                )
                .then(() => true)
                .catch(() => false);

            if (domClicked) {
              const dialogAfterDomClick =
                await findFacebookCreatePostDialog(
                  page,
                  1800,
                ).catch(() => null);

              if (dialogAfterDomClick) {
                composerOpened =
                  true;
                break;
              }
            }
          }

          if (composerOpened) {
            break;
          }
        }

        if (!composerOpened) {
          await page.waitForTimeout(
            1000,
          );
        }
      }

      if (!composerOpened) {
        const loginFormAfterComposerFailure =
          await page
            .locator(
              'input[name="email"]:visible, input[name="pass"]:visible, input[type="password"]:visible',
            )
            .count()
            .then((count) => count > 0)
            .catch(() => false);

        const bodyTextAfterComposerFailure =
          (
            await page
              .locator("body")
              .innerText()
              .catch(() => "")
          )
            .replace(/\s+/g, " ")
            .trim();

        const bodyPreview =
          bodyTextAfterComposerFailure.slice(
            0,
            1200,
          );

        const loginTextAfterComposerFailure =
          bodyTextAfterComposerFailure.toLowerCase();

        if (
          loginFormAfterComposerFailure ||
          (
            loginTextAfterComposerFailure.includes(
              "email or phone number",
            ) &&
            loginTextAfterComposerFailure.includes(
              "password",
            ) &&
            loginTextAfterComposerFailure.includes(
              "log in",
            )
          )
        ) {
          response.status(400).json({
            success: false,
            loginRequired: true,
            message:
              "Facebook login is required.",
          });
          return;
        }

        const visibleActions =
          await page
            .locator(
              [
                "button",
                '[role="button"]',
                '[role="link"]',
              ].join(", "),
            )
            .evaluateAll(
              (elements) =>
                elements
                  .filter(
                    (element) => {
                      const html =
                        element as HTMLElement;

                      const rect =
                        html.getBoundingClientRect();

                      const style =
                        window.getComputedStyle(
                          html,
                        );

                      return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.display !== "none" &&
                        style.visibility !== "hidden"
                      );
                    },
                  )
                  .slice(
                    0,
                    40,
                  )
                  .map(
                    (element) => {
                      const html =
                        element as HTMLElement;

                      return {
                        text:
                          (
                            html.innerText ||
                            ""
                          )
                            .replace(
                              /\s+/g,
                              " ",
                            )
                            .trim()
                            .slice(
                              0,
                              120,
                            ),

                        ariaLabel:
                          html.getAttribute(
                            "aria-label",
                          ),
                      };
                    },
                  ),
            )
            .catch(() => []);

        console.error(
          "[facebook/composer-trigger-not-found]",
          {
            targetUrl,
            finalUrl:
              page.url(),
            title:
              await page
                .title()
                .catch(() => ""),
            attempts:
              composerTriggerAttempt,
            waitedMs:
              Date.now() -
              composerTriggerStartedAt,
            bodyPreview,
            visibleActions,
          },
        );

        throw new Error(
          [
            "Facebook composer trigger was not found",
            `after ${composerTriggerAttempt} attempts.`,
            `URL: ${page.url()}.`,
            `Page text: ${bodyPreview.slice(0, 500)}`,
          ].join(" "),
        );
      }

      console.log(
        "[facebook/composer-trigger-found]",
        {
          url:
            page.url(),
          attempt:
            composerTriggerAttempt,
          waitedMs:
            Date.now() -
            composerTriggerStartedAt,
        },
      );

      await page.waitForTimeout(
        1200,
      );

      const dialog =
        await findFacebookCreatePostDialog(
          page,
        );

      completeTraceStep({
        stepKey:
          "OPEN_COMPOSER",
        stepName:
          "Open Facebook composer",
        stepOrder:
          3,
        startedAtMs:
          openComposerStartedAt,
        metadata: {
          composerOpened:
            true,
        },
      });

      const verifyEditorStartedAt =
        Date.now();

      const editorCandidates = [
        dialog.locator(
          '[contenteditable="true"][role="textbox"]',
        ),
        dialog.locator(
          '[contenteditable="true"][data-lexical-editor="true"]',
        ),
        dialog.locator(
          '[contenteditable="true"]',
        ),
        page.locator(
          '[role="dialog"] [contenteditable="true"]',
        ),
        page.locator(
          '[contenteditable="true"][role="textbox"]',
        ),
        page.getByRole(
          "textbox",
        ),
      ];

      let editorFound =
        false;

      for (
        const editorCandidate
        of editorCandidates
      ) {
        const count =
          await editorCandidate
            .count()
            .catch(() => 0);

        for (
          let index = count - 1;
          index >= 0;
          index -= 1
        ) {
          const editor =
            editorCandidate.nth(
              index,
            );

          if (
            !await editor
              .isVisible()
              .catch(() => false)
          ) {
            continue;
          }

          await editor.click({
            force: true,
          });

          const editable =
            await editor
              .getAttribute(
                "contenteditable",
              )
              .catch(() => null);

          const role =
            await editor
              .getAttribute(
                "role",
              )
              .catch(() => null);

          if (
            editable === "true" ||
            role === "textbox"
          ) {
            editorFound =
              true;
            break;
          }
        }

        if (editorFound) {
          break;
        }
      }

      if (!editorFound) {
        throw new Error(
          "Facebook post editor was not found.",
        );
      }

      completeTraceStep({
        stepKey:
          "VERIFY_EDITOR",
        stepName:
          "Verify Facebook editor",
        stepOrder:
          4,
        startedAtMs:
          verifyEditorStartedAt,
        metadata: {
          editorFound,
        },
      });

      let imageAttached = false;
      let attachedMediaCount = 0;
      let baselineMediaCount = 0;

      /*
       * FACEBOOK_VISIBLE_COMPOSER_MEDIA_SCOPE_V1
       *
       * Facebook can mount another role=dialog node while processing an
       * upload. Because Playwright's `.last()` locator is resolved live, the
       * original `dialog` locator may then point at that temporary dialog
       * instead of the still-visible Create post composer. Count previews
       * across the currently visible dialogs so the verification follows the
       * real composer without weakening the visible-preview requirement.
       */
      const visibleComposerDialogs =
        page.locator('[role="dialog"]:visible');

      if (imagePaths.length > 0) {
        const uploadImageStartedAt = Date.now();

        baselineMediaCount = await countFacebookComposerImagePreviews(
          visibleComposerDialogs,
        );

        let imageUpload;

        try {
          imageUpload =
            await uploadFacebookComposerImages(
              page,
              dialog,
              imagePaths,
            );
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : String(error);
          const controlDiagnostics =
            error instanceof
            FacebookComposerImageUploadError
              ? error.diagnostics
              : null;

          completeTraceStep({
            stepKey: "UPLOAD_IMAGE",
            stepName: "Upload post image",
            stepOrder: 6,
            startedAtMs: uploadImageStartedAt,
            status: "FAILED",
            metadata: {
              imageAttached: false,
              expectedMediaCount:
                imagePaths.length,
              attachedMediaCount: 0,
              baselineMediaCount,
              imagePaths,
              controlDiagnostics,
            },
            errorMessage,
          });

          console.error(
            "[facebook/image-upload-control-failure]",
            {
              errorMessage,
              controlDiagnostics,
            },
          );

          throw error;
        }

        const imageDialogHandling = await handleFacebookOnboarding(page);

        const previewResult = await waitForFacebookComposerImagePreviews(
          visibleComposerDialogs,
          {
            baselineCount: baselineMediaCount,
            expectedAddedCount: imagePaths.length,
          },
        );

        imageAttached = previewResult.attached;
        attachedMediaCount = previewResult.addedCount;

        completeTraceStep({
          stepKey: "UPLOAD_IMAGE",
          stepName: "Upload post image",
          stepOrder: 6,
          startedAtMs: uploadImageStartedAt,
          status: imageAttached ? "SUCCESS" : "FAILED",
          metadata: {
            imageAttached,
            expectedMediaCount: imagePaths.length,
            attachedMediaCount,
            baselineMediaCount,
            previewCount: previewResult.previewCount,
            waitedMs: previewResult.waitedMs,
            previewCandidates:
              previewResult.previewCandidates,
            imagePaths,
            imageUpload,
            imageDialogHandling,
          },
          errorMessage: imageAttached
            ? null
            : [
                "Facebook image previews did not appear.",
                `Expected ${imagePaths.length},`,
                `attached ${attachedMediaCount}.`,
              ].join(" "),
        });

        if (!imageAttached) {
          console.error(
            "[facebook/image-preview-verification]",
            {
              expectedMediaCount:
                imagePaths.length,
              attachedMediaCount,
              baselineMediaCount,
              previewCount:
                previewResult.previewCount,
              waitedMs:
                previewResult.waitedMs,
              previewCandidates:
                previewResult.previewCandidates,
            },
          );

          throw new Error(
            [
              "Facebook image upload could not be verified.",
              `Expected ${imagePaths.length} image(s),`,
              `attached ${attachedMediaCount}.`,
            ].join(" "),
          );
        }
      } else {
        const skippedAt =
          Date.now();

        completeTraceStep({
          stepKey:
            "UPLOAD_IMAGE",
          stepName:
            "Upload post image",
          stepOrder:
            6,
          startedAtMs:
            skippedAt,
          status:
            "SKIPPED",
          metadata: {
            reason:
              "No image was supplied.",
          },
          errorMessage:
            "No image was supplied.",
        });
      }

      await page.waitForTimeout(
        700,
      );

      const onboardingHandled =
        await handleFacebookOnboarding(
          page,
        );

      await page.waitForTimeout(
        700,
      );

      const waitStableStartedAt =
        Date.now();

      const composerStability =
        await waitForFacebookComposerStable(
          page,
        );

      const fillCaptionStartedAt =
        Date.now();

      const captionResult =
        await fillFacebookComposerCaption(
          page,
          caption,
        );

      completeTraceStep({
        stepKey:
          "FILL_CAPTION",
        stepName:
          "Fill post caption",
        stepOrder:
          5,
        startedAtMs:
          fillCaptionStartedAt,
        status:
          captionResult.filled
            ? "SUCCESS"
            : "FAILED",
        metadata: {
          captionLength:
            caption.length,
          writtenLength:
            captionResult.writtenLength,
          filled:
            captionResult.filled,
        },
        errorMessage:
          captionResult.filled
            ? null
            : "Facebook caption was not filled.",
      });

      await page.waitForTimeout(
        1000,
      );

      const expectedCaptionText =
        caption
          .replace(/\s+/g, " ")
          .trim();
      let finalCaptionText =
        "";

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const finalEditors =
          page.locator(
            '[role="dialog"] [contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
          );

        const finalEditorCount =
          await finalEditors
            .count()
            .catch(() => 0);

        for (
          let index =
            finalEditorCount - 1;
          index >= 0;
          index -= 1
        ) {
          const editor =
            finalEditors.nth(index);

          if (
            !await editor
              .isVisible()
              .catch(() => false)
          ) {
            continue;
          }

          const editorText =
            (
              await editor
                .innerText()
                .catch(() => "")
            )
              .replace(/\s+/g, " ")
              .trim();

          const editorTextContent =
            (
              await editor
                .textContent()
                .catch(() => "")
            ) || "";

          const normalizedEditorTextContent =
            editorTextContent
              .replace(/\s+/g, " ")
              .trim();

          finalCaptionText =
            editorText.length >= normalizedEditorTextContent.length
              ? editorText
              : normalizedEditorTextContent;

          if (
            finalCaptionText.includes(
              expectedCaptionText,
            )
          ) {
            break;
          }
        }

        if (
          finalCaptionText.includes(
            expectedCaptionText,
          )
        ) {
          break;
        }

        await page.waitForTimeout(500);
      }

      if (
        !finalCaptionText.includes(
          expectedCaptionText,
        )
      ) {
        throw new Error(
          "Facebook caption disappeared after final verification.",
        );
      }

      if (imagePaths.length > 0) {
        const finalMediaPreviewCount =
          await countFacebookComposerImagePreviews(
            visibleComposerDialogs,
          );

        attachedMediaCount = Math.max(
          0,
          finalMediaPreviewCount - baselineMediaCount,
        );
        imageAttached = attachedMediaCount >= imagePaths.length;

        if (!imageAttached) {
          throw new Error(
            [
              "Facebook image previews disappeared before final verification.",
              `Expected ${imagePaths.length} image(s),`,
              `attached ${attachedMediaCount}.`,
            ].join(" "),
          );
        }
      }

      session.preparedFacebookMediaCount = attachedMediaCount;

      completeTraceStep({
        stepKey:
          "WAIT_STABLE",
        stepName:
          "Wait for composer stability",
        stepOrder:
          7,
        startedAtMs:
          waitStableStartedAt,
        status:
          composerStability.stable
            ? "SUCCESS"
            : "FAILED",
        metadata: {
          ...composerStability,
          captionFilled: captionResult.filled,
          finalCaptionLength: finalCaptionText.length,
          expectedMediaCount: imagePaths.length,
          attachedMediaCount,
        },
        errorMessage:
          composerStability.stable
            ? null
            : "Facebook composer did not become stable.",
      });

      const readyStartedAt =
        Date.now();

      const screenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 70,
          fullPage: false,
        });


      const savedScreenshot =
        await saveBrowserScreenshot({
          profileKey,
          action:
            "prepare",
          buffer:
            screenshot,
        });

      session.currentUrl =
        page.url();

      completeTraceStep({
        stepKey:
          "READY_FOR_REVIEW",
        stepName:
          "Ready for human review",
        stepOrder:
          8,
        startedAtMs:
          readyStartedAt,
        metadata: {
          readyForReview:
            true,
          screenshotPath:
            savedScreenshot.absolutePath,
        },
      });

      response.json({
        success: true,
        executionTrace,
        browserProfileKey:
          session.browserProfileKey,
        composerOpened: true,
        composerReset,
        captionFilled:
          captionResult.filled,
        composerStability,
        finalCaptionLength:
          finalCaptionText.length,
        captionLength:
          captionResult.writtenLength,
        imageAttached,
        expectedMediaCount: imagePaths.length,
        attachedMediaCount,
        readyForReview: true,
        published: false,
        dialogHandling:
          onboardingHandled,
        page: {
          title:
            await page.title(),
          url:
            page.url(),
        },
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
          absolutePath:
            savedScreenshot.absolutePath,
          relativePath:
            savedScreenshot.relativePath,
          filename:
            savedScreenshot.filename,
        },
        preparedAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      const page =
        automationPage;

      console.error(
        "[facebook/prepare-post]",
        {
          profileKey,
          message:
            error instanceof Error
              ? error.message
              : "Unknown prepare error",
          url:
            page?.url() ||
            null,

          targetUrl,
        },
      );

      const screenshot =
        page
          ? await page
              .screenshot({
                type: "jpeg",
                quality: 60,
                fullPage: false,
              })
              .catch(() => null)
          : null;

      if (
        automationPage &&
        !automationPage.isClosed()
      ) {
        await automationPage
          .close()
          .catch(
            () => undefined,
          );
      }

      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to prepare Facebook post.",
        screenshot:
          screenshot
            ? {
                mimeType:
                  "image/jpeg",
                base64:
                  screenshot.toString(
                    "base64",
                  ),
              }
            : null,
      });
    } finally {
      await stagedImageCleanup?.().catch(
        () => undefined,
      );
    }
  },
);


app.post(
  "/profiles/:profileKey/instagram/prepare-post",
  async (request, response) => {
    const profileKey = request.params.profileKey;
    const session = sessions.get(profileKey);
    if (!session) {
      response.status(404).json({ success: false, message: "Browser profile is not running." });
      return;
    }

    const input = request.body as {
      caption?: string;
      imagePath?: string | null;
      imageUrl?: string | null;
      imagePaths?: string[];
      imageUrls?: string[];
    };
    const caption = input.caption?.trim();
    if (!caption) {
      response.status(400).json({ success: false, message: "Instagram caption is required." });
      return;
    }

    let imagePaths = (Array.isArray(input.imagePaths) ? input.imagePaths : [])
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter((value): value is string => Boolean(value));
    if (!imagePaths.length && input.imagePath?.trim()) {
      imagePaths = [input.imagePath.trim()];
    }
    const imageUrls = (Array.isArray(input.imageUrls) ? input.imageUrls : [])
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter((value): value is string => Boolean(value));
    if (!imageUrls.length && input.imageUrl?.trim()) {
      imageUrls.push(input.imageUrl.trim());
    }
    let stagingDirectory: string | null = null;
    try {
      if (imagePaths.length + imageUrls.length > 10) throw new Error("Instagram carousel supports up to 10 images.");
      if (imageUrls.length) {
        stagingDirectory = await mkdtemp(path.join(tmpdir(), "atlas-instagram-image-"));
        for (const [index, imageUrl] of imageUrls.entries()) {
          const parsed = new URL(imageUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Image URL must use http or https.");
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) throw new Error(`Unable to download image ${index + 1} (HTTP ${imageResponse.status}).`);
          const bytes = Buffer.from(await imageResponse.arrayBuffer());
          if (!bytes.length) throw new Error(`Remote image ${index + 1} is empty.`);
          const imagePath = path.join(stagingDirectory, `upload-${index + 1}.jpg`);
          await writeFile(imagePath, bytes);
          imagePaths.push(imagePath);
        }
      }
      if (!imagePaths.length) throw new Error("Instagram browser publishing requires an image asset.");
      await Promise.all(imagePaths.map((imagePath) => access(imagePath)));

      const page = await session.context.newPage();
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1200);
      const url = page.url().toLowerCase();
      const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
      const loginRequired = url.includes("/accounts/login") || await page.locator('input[name="username"], input[name="password"]').count().then((count) => count > 0).catch(() => false) || bodyText.includes("log in") && bodyText.includes("sign up");
      if (loginRequired) {
        await page.close().catch(() => undefined);
        response.status(400).json({ success: false, loginRequired: true, message: "Instagram login is required." });
        return;
      }

      await openInstagramComposer(page);
      const attachedMediaCount = await attachInstagramMedia(page, imagePaths);
      await clickInstagramNext(page);
      await clickInstagramNext(page);
      await fillInstagramCaption(page, caption);

      const dialog = findInstagramDialog(page);
      await dialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
      response.json({ success: true, readyForReview: true, published: false, imageAttached: attachedMediaCount === imagePaths.length, attachedMediaCount, browserProfileKey: session.browserProfileKey, page: { title: await page.title(), url: page.url() }, preparedAt: new Date().toISOString() });
    } catch (error) {
      response.status(400).json({ success: false, message: error instanceof Error ? error.message : "Unable to prepare Instagram post." });
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  },
);

app.post(
  "/profiles/:profileKey/instagram/publish-post",
  async (request, response) => {
    const profileKey = request.params.profileKey;
    const session = sessions.get(profileKey);
    if (!session) {
      response.status(404).json({ success: false, message: "Browser profile is not running." });
      return;
    }
    const input = request.body as { confirmation?: string };
    if (input.confirmation !== "PUBLISH") {
      response.status(400).json({ success: false, message: 'Explicit confirmation "PUBLISH" is required.' });
      return;
    }
    try {
      const page = session.context.pages().at(-1);
      if (!page) throw new Error("No active browser page was found.");
      const dialog = findInstagramDialog(page);
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      const shareConfirmed = await clickInstagramShare(page);
      const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
      const confirmed = shareConfirmed || /post shared|your post has been shared|shared|posted/.test(bodyText);
      if (!confirmed) throw new Error("Instagram publishing was not confirmed.");
      response.json({ success: true, published: true, verification: { status: "CONFIRMED" }, page: { title: await page.title(), url: page.url() }, publishedAt: new Date().toISOString() });
    } catch (error) {
      response.status(400).json({ success: false, message: error instanceof Error ? error.message : "Unable to publish Instagram post." });
    }
  },
);

app.post(
  "/profiles/:profileKey/instagram/discard-post",
  async (request, response) => {
    const profileKey = request.params.profileKey;
    const session = sessions.get(profileKey);
    if (!session) {
      response.status(404).json({ success: false, message: "Browser profile is not running." });
      return;
    }

    try {
      const page = session.context.pages().at(-1);
      if (!page) {
        response.json({ success: true, discarded: false, alreadyClosed: true });
        return;
      }
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.close().catch(() => undefined);
      response.json({ success: true, discarded: true, alreadyClosed: false });
    } catch (error) {
      response.status(400).json({ success: false, message: error instanceof Error ? error.message : "Unable to discard Instagram post." });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/login",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(profileKey);

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    const input =
      request.body as {
        confirmation?: string;
      };

    if (
      input.confirmation !==
      "LOGIN"
    ) {
      response.status(400).json({
        success: false,
        message:
          'Explicit confirmation "LOGIN" is required.',
      });
      return;
    }

    const email =
      process.env
        .FACEBOOK_LOGIN_EMAIL
        ?.trim();

    const password =
      process.env
        .FACEBOOK_LOGIN_PASSWORD;

    if (!email || !password) {
      response.status(400).json({
        success: false,
        message:
          [
            "Facebook login credentials",
            "are not configured.",
            "Set FACEBOOK_LOGIN_EMAIL",
            "and FACEBOOK_LOGIN_PASSWORD",
            "in browser-worker variables.",
          ].join(" "),
      });
      return;
    }

    try {
      const pages =
        session.context.pages();

      const page =
        pages.at(-1) ||
        await session.context.newPage();

      if (
        !page.url().includes(
          "facebook.com",
        )
      ) {
        await page.goto(
          "https://www.facebook.com/",
          {
            waitUntil:
              "domcontentloaded",
            timeout:
              60000,
          },
        );
      }

      const emailInput =
        page.locator(
          [
            'input[name="email"]',
            'input[type="text"]',
          ].join(", "),
        ).first();

      const passwordInput =
        page.locator(
          'input[name="pass"], input[type="password"]',
        ).first();

      if (
        !await emailInput
          .isVisible()
          .catch(() => false) ||
        !await passwordInput
          .isVisible()
          .catch(() => false)
      ) {
        const pageText =
          (
            await page
              .locator("body")
              .innerText()
              .catch(() => "")
          )
            .replace(
              /\s+/g,
              " ",
            )
            .trim();

        const alreadyLoggedIn =
          !/log into facebook/i
            .test(pageText) &&
          !/email or mobile number/i
            .test(pageText);

        if (alreadyLoggedIn) {
          response.json({
            success: true,
            alreadyLoggedIn:
              true,
            loginCompleted:
              true,
            twoFactorRequired:
              false,
            page: {
              title:
                await page.title(),
              url:
                page.url(),
            },
          });
          return;
        }

        throw new Error(
          "Facebook login fields were not found.",
        );
      }

      await emailInput.fill(
        email,
      );

      await passwordInput.fill(
        password,
      );

      const loginButton =
        page
          .getByRole(
            "button",
            {
              name:
                /^log in$/i,
            },
          )
          .first();

      if (
        await loginButton
          .isVisible()
          .catch(() => false)
      ) {
        await loginButton.click({
          timeout:
            15000,
        });
      } else {
        const submitInput =
          page.locator(
            [
              'button[name="login"]',
              'input[name="login"]',
              'button[type="submit"]',
              'input[type="submit"]',
            ].join(", "),
          ).first();

        if (
          !await submitInput
            .isVisible()
            .catch(() => false)
        ) {
          throw new Error(
            "Facebook Log in button was not found.",
          );
        }

        await submitInput.click({
          timeout:
            15000,
        });
      }

      await page.waitForTimeout(
        5000,
      );

      const currentUrl =
        page.url();

      const bodyText =
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        )
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const lowerText =
        bodyText.toLowerCase();

      const twoFactorRequired =
        currentUrl.includes(
          "/checkpoint/",
        ) ||
        currentUrl.includes(
          "/two_step_verification/",
        ) ||
        lowerText.includes(
          "two-factor authentication",
        ) ||
        lowerText.includes(
          "enter login code",
        ) ||
        lowerText.includes(
          "enter the code",
        ) ||
        lowerText.includes(
          "authentication code",
        );

      const loginRequired =
        currentUrl.includes(
          "/login",
        ) ||
        (
          lowerText.includes(
            "email or mobile number",
          ) &&
          lowerText.includes(
            "password",
          )
        );

      const loginCompleted =
        !twoFactorRequired &&
        !loginRequired;

      session.currentUrl =
        currentUrl;

      const screenshot =
        await page.screenshot({
          type:
            "jpeg",
          quality:
            70,
          fullPage:
            false,
        });

      response.json({
        success:
          loginCompleted ||
          twoFactorRequired,
        loginCompleted,
        twoFactorRequired,
        loginRequired,
        browserProfileKey:
          session.browserProfileKey,
        page: {
          title:
            await page.title(),
          url:
            currentUrl,
          textPreview:
            bodyText.slice(
              0,
              3000,
            ),
        },
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
        },
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        loginCompleted:
          false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to log into Facebook.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/submit-2fa",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(profileKey);

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    const input =
      request.body as {
        code?: string;
      };

    const code =
      input.code
        ?.replace(
          /\s+/g,
          "",
        )
        .trim();

    if (
      !code ||
      !/^\d{4,10}$/.test(code)
    ) {
      response.status(400).json({
        success: false,
        message:
          "A valid Facebook verification code is required.",
      });
      return;
    }

    try {
      const pages =
        session.context.pages();

      const page =
        pages.at(-1);

      if (!page) {
        throw new Error(
          "No active Facebook page was found.",
        );
      }

      const codeSelectors = [
        'input[name="approvals_code"]',
        'input[name="code"]',
        'input[name*="code" i]',
        'input[id*="code" i]',
        'input[autocomplete="one-time-code"]',
        'input[inputmode="numeric"]',
        'input[type="tel"]',
        'input[type="number"]',
        'input[type="text"]',
      ];

      const locatedCodeInput =
        await findVisibleLocatorAcrossFrames(
          page,
          codeSelectors,
        );

      if (!locatedCodeInput) {
        const frameInspection =
          await inspectAllFrames(
            page,
          );

        throw new Error(
          [
            "Facebook verification-code input",
            "was not found in the main page",
            "or any iframe.",
            `Frames inspected: ${JSON.stringify(
              frameInspection.map(
                (frame) => ({
                  frameUrl:
                    frame.frameUrl,
                  frameName:
                    frame.frameName,
                  visibleInputs:
                    frame.inputs
                      .filter(
                        (input) =>
                          input.visible,
                      )
                      .map(
                        (input) => ({
                          type:
                            input.type,
                          name:
                            input.name,
                          id:
                            input.id,
                          autocomplete:
                            input.autocomplete,
                          inputMode:
                            input.inputMode,
                          ariaLabel:
                            input.ariaLabel,
                        }),
                      ),
                }),
              ),
            )}`,
          ].join(" "),
        );
      }

      const codeInput =
        locatedCodeInput
          .locator;

      const codeFrame =
        locatedCodeInput
          .frame;

      await codeInput.fill(
        code,
      );

      const continuePatterns = [
        /^continue$/i,
        /^submit$/i,
        /^confirm$/i,
        /^next$/i,
        /^log in$/i,
        /^verify$/i,
        /^approve$/i,
        /continue/i,
        /submit/i,
        /confirm/i,
        /verify/i,
      ];

      const locatedSubmitButton =
        await findVisibleButtonAcrossFrames(
          page,
          continuePatterns,
        );

      let submitted =
        false;

      if (locatedSubmitButton) {
        await locatedSubmitButton
          .locator
          .click({
            timeout:
              15000,
          });

        submitted =
          true;
      }

      if (!submitted) {
        await codeInput.press(
          "Enter",
        );
      }

      await codeFrame
        .waitForTimeout(
          1000,
        )
        .catch(() => undefined);

      await page.waitForTimeout(
        6000,
      );

      const currentUrl =
        page.url();

      const bodyText =
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        )
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const lowerText =
        bodyText.toLowerCase();

      const stillWaiting =
        currentUrl.includes(
          "/checkpoint/",
        ) ||
        currentUrl.includes(
          "/two_step_verification/",
        ) ||
        lowerText.includes(
          "enter login code",
        ) ||
        lowerText.includes(
          "enter the code",
        ) ||
        lowerText.includes(
          "authentication code",
        );

      const loginCompleted =
        !stillWaiting &&
        !currentUrl.includes(
          "/login",
        );

      session.currentUrl =
        currentUrl;

      const screenshot =
        await page.screenshot({
          type:
            "jpeg",
          quality:
            70,
          fullPage:
            false,
        });

      response.json({
        success:
          loginCompleted,
        loginCompleted,
        stillWaiting,
        browserProfileKey:
          session.browserProfileKey,
        page: {
          title:
            await page.title(),
          url:
            currentUrl,
          textPreview:
            bodyText.slice(
              0,
              3000,
            ),
        },
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
        },
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        loginCompleted:
          false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit Facebook verification code.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/inspect",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    try {
      const page =
        await getPreferredFacebookPage(
          session.context,
        );

      const title =
        await page.title();

      const url =
        page.url();

      session.currentUrl =
        url;

      const visibleText =
        await page.locator("body")
          .innerText({
            timeout: 10000,
          })
          .catch(() => "");

      const buttons =
        await page
          .locator(
            'button, [role="button"]',
          )
          .evaluateAll(
            (elements) =>
              elements
                .filter((element) => {
                  const html =
                    element as HTMLElement;

                  const style =
                    window.getComputedStyle(
                      html,
                    );

                  return (
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden" &&
                    html.offsetParent !==
                      null
                  );
                })
                .slice(0, 80)
                .map((element) => {
                  const html =
                    element as HTMLElement;

                  return {
                    text:
                      (
                        html.innerText ||
                        html.getAttribute(
                          "aria-label",
                        ) ||
                        ""
                      )
                        .trim()
                        .slice(0, 160),
                    ariaLabel:
                      html.getAttribute(
                        "aria-label",
                      ),
                    role:
                      html.getAttribute(
                        "role",
                      ),
                    tag:
                      html.tagName
                        .toLowerCase(),
                  };
                }),
          );

      const inputs =
        await page
          .locator(
            'input, textarea, [contenteditable="true"]',
          )
          .evaluateAll(
            (elements) =>
              elements
                .filter((element) => {
                  const html =
                    element as HTMLElement;

                  const style =
                    window.getComputedStyle(
                      html,
                    );

                  return (
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden" &&
                    html.offsetParent !==
                      null
                  );
                })
                .slice(0, 50)
                .map((element) => {
                  const html =
                    element as HTMLElement;

                  return {
                    tag:
                      html.tagName
                        .toLowerCase(),
                    type:
                      element.getAttribute(
                        "type",
                      ),
                    placeholder:
                      element.getAttribute(
                        "placeholder",
                      ),
                    ariaLabel:
                      element.getAttribute(
                        "aria-label",
                      ),
                    contentEditable:
                      element.getAttribute(
                        "contenteditable",
                      ),
                  };
                }),
          );

      const frameInspections =
        await inspectAllFrames(
          page,
        );

      const frameUrls =
        page
          .frames()
          .map(
            (frame) => ({
              url:
                frame.url(),
              name:
                frame.name(),
              isMainFrame:
                frame ===
                page.mainFrame(),
            }),
          );


      const links =
        await page
          .locator("a[href]")
          .evaluateAll(
            (elements) =>
              elements
                .filter((element) => {
                  const html =
                    element as HTMLElement;

                  const style =
                    window.getComputedStyle(
                      html,
                    );

                  return (
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden" &&
                    html.offsetParent !==
                      null
                  );
                })
                .slice(0, 60)
                .map((element) => {
                  const html =
                    element as HTMLAnchorElement;

                  return {
                    text:
                      (
                        html.innerText ||
                        html.getAttribute(
                          "aria-label",
                        ) ||
                        ""
                      )
                        .trim()
                        .slice(0, 160),
                    href:
                      html.href,
                    ariaLabel:
                      html.getAttribute(
                        "aria-label",
                      ),
                  };
                }),
          );

      const screenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 60,
          fullPage: false,
        });

      const normalizedText =
        visibleText
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const lowerText =
        normalizedText
          .toLowerCase();

      const loginLikely =
        url.includes(
          "facebook.com/login",
        ) ||
        (
          lowerText.includes(
            "log in",
          ) &&
          lowerText.includes(
            "password",
          )
        );

      response.json({
        success: true,
        browserProfileKey:
          session.browserProfileKey,
        page: {
          title,
          url,
          loginLikely,
          textPreview:
            normalizedText.slice(
              0,
              5000,
            ),
          buttons,
          inputs,
          links,
        },
        frameUrls,
        frameInspections,
        screenshot: {
          mimeType:
            "image/jpeg",
          base64:
            screenshot.toString(
              "base64",
            ),
          width: 1365,
          height: 768,
        },
        inspectedAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to inspect browser page.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/check-ip",
  async (request, response) => {
    const session =
      sessions.get(
        request.params.profileKey,
      );

    if (!session) {
      response.status(404).json({
        message:
          "Browser profile is not running.",
      });
      return;
    }

    const startedAt =
      Date.now();

    try {
      const ip =
        await inspectPublicIp(
          session.context,
        );

      response.json({
        success: true,
        browserProfileKey:
          session.browserProfileKey,
        proxyType:
          session.proxyType,
        ip,
        latencyMs:
          Date.now() -
          startedAt,
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to inspect browser IP.",
      });
    }
  },
);


app.post(
  "/profiles/:profileKey/facebook/discover-pages",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.status(404).json({
        success: false,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    try {
      const page =
        await getPreferredFacebookPage(
          session.context,
        );

      const discoveryUrl =
        "https://www.facebook.com/pages/?category=your_pages";

      await page.goto(
        discoveryUrl,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 45000,
        },
      );

      await page.waitForTimeout(
        3500,
      );

      const currentUrl =
        page.url();

      const bodyText =
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        )
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const loginRequired =
        Boolean(
          await page
            .locator(
              'input[name="email"], input[name="pass"]',
            )
            .count()
            .catch(() => 0),
        ) ||
        bodyText
          .toLowerCase()
          .includes(
            "log in to facebook",
          );

      const checkpointRequired =
        currentUrl
          .toLowerCase()
          .includes(
            "/checkpoint",
          ) ||
        bodyText
          .toLowerCase()
          .includes(
            "confirm your identity",
          );

      if (
        loginRequired ||
        checkpointRequired
      ) {
        response.status(409).json({
          success: false,
          loginRequired,
          checkpointRequired,
          currentUrl,
          message:
            checkpointRequired
              ? "Facebook checkpoint requires attention."
              : "Facebook login is required.",
        });
        return;
      }

      const discoveredCandidates =
        await page.evaluate(() => {
          type PageCandidate = {
            pageId: string | null;
            name: string;
            url: string;
            imageUrl: string | null;
          };

          const normalizeUrl = (
            value: string,
          ) => {
            try {
              return new URL(
                value,
                window.location.origin,
              ).toString();
            } catch {
              return "";
            }
          };

          const extractPageId = (
            value: string,
          ) => {
            try {
              const url =
                new URL(
                  value,
                  window.location.origin,
                );

              const idFromQuery =
                url.searchParams.get(
                  "id",
                );

              if (
                idFromQuery &&
                /^\d+$/.test(
                  idFromQuery,
                )
              ) {
                return idFromQuery;
              }

              const match =
                url.pathname.match(
                  /\/(?:profile\.php\/|pages\/(?:[^/]+\/)?)*(\d{5,})/,
                );

              return match?.[1] ||
                null;
            } catch {
              return null;
            }
          };

          const anchors =
            Array.from(
              document.querySelectorAll<
                HTMLAnchorElement
              >("a[href]"),
            );

          const candidates:
            PageCandidate[] = [];

          const reservedPaths =
            new Set([
              "ads",
              "adsmanager",
              "bookmarks",
              "business",
              "events",
              "friends",
              "gaming",
              "groups",
              "help",
              "latest",
              "marketplace",
              "me",
              "memories",
              "messages",
              "notifications",
              "pages",
              "policies",
              "privacy",
              "profile.php",
              "reels",
              "settings",
              "watch",
            ]);

          for (
            const anchor
            of anchors
          ) {
            const rawHref =
              anchor.getAttribute(
                "href",
              ) || "";

            const url =
              normalizeUrl(
                rawHref,
              );

            if (
              !url ||
              !url.includes(
                "facebook.com",
              )
            ) {
              continue;
            }

            const text =
              (
                anchor.innerText ||
                anchor.textContent ||
                ""
              )
                .replace(
                  /\s+/g,
                  " ",
                )
                .trim();

            if (
              !text ||
              text.length < 2 ||
              text.length > 120
            ) {
              continue;
            }

            const lowerText =
              text.toLowerCase();

            if (
              [
                "home",
                "pages",
                "create page",
                "see all",
                "settings",
                "notifications",
                "messages",
                "find friends",
                "meta business suite",
                "professional dashboard",
                "switch now",
                "view profile",
              ].includes(
                lowerText,
              )
            ) {
              continue;
            }

            const image =
              anchor.querySelector<
                HTMLImageElement
              >("img");

            const pageId =
              extractPageId(
                url,
              );

            const pathname =
              new URL(
                url,
              ).pathname;

            const firstPathPart =
              pathname
                .split("/")
                .filter(Boolean)[0]
                ?.toLowerCase() ||
              "";

            const likelyPageLink =
              Boolean(
                pageId,
              ) ||
              (
                pathname !== "/" &&
                !reservedPaths.has(
                  firstPathPart,
                ) &&
                Boolean(image)
              );

            if (!likelyPageLink) {
              continue;
            }

            candidates.push({
              pageId,
              name: text,
              url,
              imageUrl:
                image?.src ||
                null,
            });
          }

          const unique =
            new Map<
              string,
              PageCandidate
            >();

          for (
            const candidate
            of candidates
          ) {
            const key =
              candidate.pageId ||
              candidate.url;

            const existing =
              unique.get(
                key,
              );

            if (
              !existing ||
              candidate.name.length >
                existing.name.length
            ) {
              unique.set(
                key,
                candidate,
              );
            }
          }

          return Array.from(
            unique.values(),
          );
        });

      const discovered =
        filterFacebookPageCandidates(
          discoveredCandidates,
        );

      response.json({
        success: true,
        browserProfileKey:
          profileKey,
        currentUrl,
        count:
          discovered.length,
        pages:
          discovered,
        discoveredAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to discover Facebook Pages.",
      });
    }
  },
);



app.post(
  "/profiles/:profileKey/ip/verify",
  async (request, response) => {
    const rawProfileKey =
      request.params.profileKey;

    let profileKey: string;

    try {
      profileKey =
        sanitizeProfileKey(
          rawProfileKey,
        );
    } catch (error) {
      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Invalid browser profile key.",
      });
      return;
    }

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.status(404).json({
        success: false,
        running: false,
        browserProfileKey:
          profileKey,
        message:
          "Browser profile is not running.",
      });
      return;
    }

    try {
      const inspected =
        await inspectPublicIp(
          session.context,
        );

      const ip =
        inspected?.trim() ||
        "";

      if (!ip) {
        throw new Error(
          "Public IP inspection returned no IP address.",
        );
      }

      response.json({
        success: true,
        running: true,
        browserProfileKey:
          profileKey,
        ip,
        proxyType:
          session.proxyType,
        checkedAt:
          new Date()
            .toISOString(),
      });
    } catch (error) {
      response.status(400).json({
        success: false,
        running: true,
        browserProfileKey:
          profileKey,
        message:
          error instanceof Error
            ? error.message
            : "Unable to inspect public IP.",
        checkedAt:
          new Date()
            .toISOString(),
      });
    }
  },
);

app.post(
  "/profiles/:profileKey/close",
  async (request, response) => {
    const profileKey =
      request.params.profileKey;

    const session =
      sessions.get(
        profileKey,
      );

    if (!session) {
      response.json({
        closed: false,
        alreadyStopped: true,
        browserProfileKey:
          profileKey,
      });
      return;
    }

    try {
      await session.context.close();

      sessions.delete(
        profileKey,
      );

      response.json({
        closed: true,
        alreadyStopped: false,
        browserProfileKey:
          profileKey,
      });
    } catch (error) {
      response.status(400).json({
        closed: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to close browser profile.",
      });
    }
  },
);

async function closeAllSessions() {
  const active =
    Array.from(
      sessions.values(),
    );

  await Promise.allSettled(
    active.map(
      async (session) => {
        await session.context.close();
      },
    ),
  );

  sessions.clear();
}

process.on(
  "SIGINT",
  async () => {
    await closeAllSessions();
    process.exit(0);
  },
);

process.on(
  "SIGTERM",
  async () => {
    await closeAllSessions();
    process.exit(0);
  },
);

/*
 * Browser Worker API remains private on 4010.
 * Secure noVNC viewer is exposed separately on 6080.
 */
startSecureViewerServer();

app.listen(
  port,
  "::",
  () => {
    console.log(
      `Atlas Browser Worker listening on port ${port}`,
    );
  },
);
