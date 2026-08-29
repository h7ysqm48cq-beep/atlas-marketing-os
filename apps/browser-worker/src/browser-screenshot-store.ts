import {
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type BrowserScreenshotAction =
  | "prepare"
  | "publish-before"
  | "publish-after"
  | "discard";

export type SavedBrowserScreenshot = {
  absolutePath: string;
  relativePath: string;
  filename: string;
};

const screenshotRoot =
  process.env
    .BROWSER_SCREENSHOT_ROOT ||
  process.env
    .BROWSER_SCREENSHOTS_ROOT ||
  path.join(
    process.cwd(),
    ".browser-screenshots",
  );

function safeSegment(
  value: string,
) {
  return value.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
}

export function getBrowserScreenshotRoot() {
  return screenshotRoot;
}

export function screenshotPathIsInsideRoot(
  root: string,
  candidate: string,
) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);

  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

export async function readBrowserScreenshot(
  absolutePath: string,
) {
  const [canonicalRoot, canonicalScreenshot] =
    await Promise.all([
      realpath(screenshotRoot),
      realpath(absolutePath),
    ]);

  if (
    !screenshotPathIsInsideRoot(
      canonicalRoot,
      canonicalScreenshot,
    )
  ) {
    throw new Error(
      "Screenshot path is outside the configured archive.",
    );
  }

  return readFile(canonicalScreenshot);
}

export async function saveBrowserScreenshot(
  input: {
    profileKey: string;
    action:
      BrowserScreenshotAction;
    buffer: Buffer;
  },
): Promise<SavedBrowserScreenshot> {
  const now =
    new Date();

  const year =
    String(
      now.getFullYear(),
    );

  const month =
    String(
      now.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      now.getDate(),
    ).padStart(2, "0");

  const profileDirectory =
    safeSegment(
      input.profileKey,
    );

  const directory =
    path.join(
      screenshotRoot,
      year,
      month,
      day,
      profileDirectory,
    );

  await mkdir(
    directory,
    {
      recursive: true,
    },
  );

  const timestamp =
    now
      .toISOString()
      .replace(
        /[:.]/g,
        "-",
      );

  const filename =
    `${timestamp}-${input.action}.jpg`;

  const absolutePath =
    path.join(
      directory,
      filename,
    );

  await writeFile(
    absolutePath,
    input.buffer,
  );

  return {
    absolutePath,
    relativePath:
      path.relative(
        screenshotRoot,
        absolutePath,
      ),
    filename,
  };
}
