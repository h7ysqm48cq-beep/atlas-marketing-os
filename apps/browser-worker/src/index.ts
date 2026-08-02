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
  mkdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

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

app.use(
  requireWorkerToken,
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
