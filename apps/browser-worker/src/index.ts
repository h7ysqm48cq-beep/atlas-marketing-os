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

    try {
      const pages =
        session.context.pages();

      const page =
        pages.at(-1) ||
        (await session.context.newPage());

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

          await editor
            .evaluate(
              (
                element,
                value,
              ) => {
                const html =
                  element as HTMLElement;

                html.focus();
                html.innerHTML = "";

                document.execCommand(
                  "insertText",
                  false,
                  value,
                );

                html.dispatchEvent(
                  new InputEvent(
                    "input",
                    {
                      bubbles: true,
                      inputType:
                        "insertText",
                      data: value,
                    },
                  ),
                );
              },
              caption,
            )
            .catch(
              async () => {
                await page.keyboard
                  .insertText(
                    caption,
                  );
              },
            );

          const writtenText =
            await editor
              .innerText()
              .catch(() => "");

          if (
            writtenText.includes(
              caption.slice(
                0,
                Math.min(
                  caption.length,
                  20,
                ),
              ),
            )
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

      let imageAttached =
        false;

      if (imagePath) {
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
      }

      await page.waitForTimeout(
        700,
      );

      const onboardingHandled =
        await handleFacebookOnboarding(
          page,
        );

      const screenshot =
        await page.screenshot({
          type: "jpeg",
          quality: 70,
          fullPage: false,
        });

      session.currentUrl =
        page.url();

      response.json({
        success: true,
        browserProfileKey:
          session.browserProfileKey,
        composerOpened: true,
        captionFilled: true,
        imageAttached,
        readyForReview: true,
        published: false,
        dialogHandling:
          onboardingHandled,
        captionLength:
          caption.length,
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
