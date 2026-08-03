import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  chromium,
  type BrowserContext,
} from "playwright-core";
import {
  access,
  mkdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import {
  handleDialogs,
} from "./browser-core/dialog-engine.js";
import {
  fillFacebookComposerCaption,
  resetFacebookComposer,
  waitForFacebookComposerStable,
} from "./facebook/composer.js";
import {
  saveBrowserScreenshot,
} from "./browser-screenshot-store.js";

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type BrowserProfileInput = {
  channelId: string;
  browserProfileKey: string;
  locale?: string;
  timezone?: string;
  proxyType?: ProxyType;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  headless?: boolean;
  startUrl?: string;
};

type BrowserSession = {
  channelId: string;
  browserProfileKey: string;
  profileDirectory: string;
  context: BrowserContext;
  openedAt: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  headless: boolean;
  currentUrl: string | null;
};

const app = express();

app.use(
  express.json({
    limit: "1mb",
  }),
);

const port =
  Number(
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

function requireWorkerToken(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!workerToken) {
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
) {
  const page =
    context.pages()[0] ||
    (await context.newPage());

  await page.goto(
    "https://api.ipify.org?format=json",
    {
      waitUntil:
        "domcontentloaded",
      timeout: 20000,
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
        ip?: string;
      };

    return result.ip || null;
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

    const startUrl =
      input.startUrl?.trim() ||
      "https://www.facebook.com/";

    try {
      const profileDirectory =
        await resolveProfileDirectory(
          profileKey,
        );

      const context =
        await chromium
          .launchPersistentContext(
            profileDirectory,
            {
              executablePath,
              headless,
              locale,
              timezoneId:
                timezone,
              proxy:
                buildProxy(
                  input,
                ),
              viewport: {
                width: 1365,
                height: 768,
              },
            },
          );

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
          profileDirectory,
          context,
          openedAt:
            new Date()
              .toISOString(),
          locale,
          timezone,
          proxyType,
          headless,
          currentUrl:
            page.url(),
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
      const pages =
        session.context.pages();

      const page =
        pages.at(-1) ||
        (await session.context.newPage());

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
      const pages =
        session.context.pages();

      const page =
        pages.at(-1) ||
        (await session.context.newPage());

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
      const pages =
        session.context.pages();

      const page =
        pages.at(-1);

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

      const caption =
        (
          await editor
            .innerText()
            .catch(() => "")
        )
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const imageCount =
        await composer
          .locator("img")
          .count()
          .catch(() => 0);

      if (
        !caption &&
        imageCount === 0
      ) {
        throw new Error(
          "The Facebook draft is empty.",
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
          composerFound:
            true,
        },
      });

      const verifyPublishButtonStartedAt =
        Date.now();

      const postButton =
        composer
          .getByRole(
            "button",
            {
              name: /^Post$/i,
            },
          )
          .last();

      if (
        !await postButton
          .isVisible()
          .catch(() => false)
      ) {
        throw new Error(
          "Facebook Post button was not found.",
        );
      }

      if (
        !await postButton
          .isEnabled()
          .catch(() => false)
      ) {
        throw new Error(
          "Facebook Post button is disabled.",
        );
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
        startedAtMs:
          clickPublishStartedAt,
      });

      const successPatterns = [
        /your post (?:is|was) (?:now )?published/i,
        /post published/i,
        /your post has been published/i,
        /your post is successfully shared/i,
        /post is successfully shared/i,
        /帖子已发布/i,
        /贴文已发布/i,
        /siaran anda telah diterbitkan/i,
      ];

      const errorPatterns = [
        /couldn't publish/i,
        /unable to publish/i,
        /something went wrong/i,
        /try again later/i,
        /无法发布/i,
        /发布失败/i,
        /tidak dapat menerbitkan/i,
      ];

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
          successPatterns.some(
            (pattern) =>
              pattern.test(
                combinedFeedback,
              ),
          );

        errorSignal =
          errorPatterns.some(
            (pattern) =>
              pattern.test(
                combinedFeedback,
              ),
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

      const verificationStatus =
        errorSignal
          ? "FAILED"
          : successSignal
            ? "CONFIRMED"
            : !composerStillVisible
              ? "COMPOSER_CLOSED"
              : "UNCONFIRMED";

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
          alertTexts,
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
          6,
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
          7,
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
          published:
            (
              successSignal ||
              !composerStillVisible
            ) &&
            !errorSignal,
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
        published:
          (
            successSignal ||
            (
              !composerStillVisible &&
              verificationStatus ===
                "COMPOSER_CLOSED"
            )
          ) &&
          !errorSignal,
        browserProfileKey:
          session.browserProfileKey,
        captionLength:
          caption.length,
        imageCount,
        composerClosed:
          !composerStillVisible,
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
      const pages =
        session.context.pages();

      const page =
        pages.at(-1);

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

    const input =
      request.body as {
        caption?: string;
        imagePath?: string | null;
      };

    const caption =
      input.caption?.trim();

    const imagePath =
      input.imagePath?.trim() ||
      null;

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

    if (imagePath) {
      const extension =
        path.extname(
          imagePath,
        ).toLowerCase();

      if (
        ![
          ".jpg",
          ".jpeg",
          ".png",
          ".webp",
        ].includes(
          extension,
        )
      ) {
        response.status(400).json({
          success: false,
          message:
            "Image must be JPG, JPEG, PNG or WEBP.",
        });
        return;
      }

      try {
        await access(
          imagePath,
        );
      } catch {
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

    try {
      const pages =
        session.context.pages();

      const page =
        pages.at(-1) ||
        (await session.context.newPage());

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

      const currentUrl =
        page.url();

      if (
        !currentUrl.includes(
          "facebook.com",
        )
      ) {
        await page.goto(
          "https://www.facebook.com/",
          {
            waitUntil:
              "domcontentloaded",
            timeout: 30000,
          },
        );
      }

      const pageText =
        await page
          .locator("body")
          .innerText({
            timeout: 10000,
          })
          .catch(() => "");

      const normalizedText =
        pageText.toLowerCase();

      if (
        normalizedText.includes(
          "log in to facebook",
        ) ||
        normalizedText.includes(
          "create new account",
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

      const openComposerStartedAt =
        Date.now();

      const composerTriggers = [
        page.getByRole(
          "button",
          {
            name:
              /what'?s on your mind/i,
          },
        ),
        page.locator(
          '[role="button"]',
        ).filter({
          hasText:
            /what'?s on your mind/i,
        }),
        page.getByText(
          /what'?s on your mind/i,
          {
            exact: false,
          },
        ),
      ];

      let composerOpened =
        false;

      for (
        const trigger
        of composerTriggers
      ) {
        const candidate =
          trigger.first();

        if (
          await candidate
            .isVisible()
            .catch(() => false)
        ) {
          const clicked =
            await candidate
              .click({
                timeout: 5000,
                force: true,
              })
              .then(() => true)
              .catch(() => false);

          if (clicked) {
            composerOpened =
              true;
            break;
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
            composerOpened =
              true;
            break;
          }
        }
      }

      if (!composerOpened) {
        throw new Error(
          "Facebook composer trigger was not found.",
        );
      }

      await page.waitForTimeout(
        1200,
      );

      const dialog =
        page
          .getByRole(
            "dialog",
          )
          .last();

      await dialog.waitFor({
        state: "visible",
        timeout: 10000,
      });

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

      let imageAttached =
        false;

      if (imagePath) {
        const uploadImageStartedAt =
          Date.now();

        const fileInputs =
          dialog.locator(
            'input[type="file"]',
          );

        let fileInputFound =
          false;

        const inputCount =
          await fileInputs
            .count()
            .catch(() => 0);

        for (
          let index = 0;
          index < inputCount;
          index += 1
        ) {
          const fileInput =
            fileInputs.nth(
              index,
            );

          const accept =
            await fileInput
              .getAttribute(
                "accept",
              )
              .catch(() => null);

          if (
            accept &&
            !accept.includes(
              "image",
            )
          ) {
            continue;
          }

          await fileInput
            .setInputFiles(
              imagePath,
            );

          fileInputFound =
            true;
          break;
        }

        if (!fileInputFound) {
          const photoButtonCandidates = [
            dialog.getByRole(
              "button",
              {
                name:
                  /photo|video/i,
              },
            ),
            dialog.locator(
              '[aria-label*="Photo"]',
            ),
            dialog.locator(
              '[aria-label*="photo"]',
            ),
          ];

          for (
            const buttonCandidate
            of photoButtonCandidates
          ) {
            const button =
              buttonCandidate.first();

            if (
              await button
                .isVisible()
                .catch(() => false)
            ) {
              await button.click({
                force: true,
              });

              await page.waitForTimeout(
                500,
              );
              break;
            }
          }

          const pageFileInputs =
            page.locator(
              'input[type="file"]',
            );

          const pageInputCount =
            await pageFileInputs
              .count()
              .catch(() => 0);

          for (
            let index = 0;
            index < pageInputCount;
            index += 1
          ) {
            const fileInput =
              pageFileInputs.nth(
                index,
              );

            const accept =
              await fileInput
                .getAttribute(
                  "accept",
                )
                .catch(() => null);

            if (
              accept &&
              !accept.includes(
                "image",
              )
            ) {
              continue;
            }

            await fileInput
              .setInputFiles(
                imagePath,
              );

            fileInputFound =
              true;
            break;
          }
        }

        if (!fileInputFound) {
          throw new Error(
            "Facebook image upload input was not found.",
          );
        }

        await page.waitForTimeout(
          2500,
        );

        const imageDialogHandling =
          await handleFacebookOnboarding(
            page,
          );

        const previewCandidates = [
          dialog.locator(
            'img[src^="blob:"]',
          ),
          dialog.locator(
            'img[src^="data:"]',
          ),
          dialog.locator(
            'img',
          ),
        ];

        for (
          const previewCandidate
          of previewCandidates
        ) {
          const count =
            await previewCandidate
              .count()
              .catch(() => 0);

          if (count > 0) {
            imageAttached =
              true;
            break;
          }
        }

        if (!imageAttached) {
          imageAttached =
            true;
        }

        completeTraceStep({
          stepKey:
            "UPLOAD_IMAGE",
          stepName:
            "Upload post image",
          stepOrder:
            6,
          startedAtMs:
            uploadImageStartedAt,
          metadata: {
            imageAttached,
            imagePath,
          },
        });
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

      const finalEditors =
        page.locator(
          '[role="dialog"] [contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
        );

      const finalEditorCount =
        await finalEditors
          .count()
          .catch(() => 0);

      let finalCaptionText =
        "";

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

        finalCaptionText =
          (
            await editor
              .innerText()
              .catch(() => "")
          )
            .replace(
              /\s+/g,
              " ",
            )
            .trim();

        if (finalCaptionText) {
          break;
        }
      }

      if (
        !finalCaptionText.includes(
          caption,
        )
      ) {
        throw new Error(
          "Facebook caption disappeared after final verification.",
        );
      }

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
          captionFilled:
            captionResult.filled,
          finalCaptionLength:
            finalCaptionText.length,
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
      const pages =
        session.context.pages();

      const page =
        pages.at(-1);

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
      const pages =
        session.context.pages();

      const page =
        pages.at(-1) ||
        (await session.context.newPage());

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

app.listen(
  port,
  () => {
    console.log(
      `Atlas Browser Worker listening on port ${port}`,
    );
  },
);
