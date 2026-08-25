import type {
  Locator,
  Page,
} from "playwright-core";

type CaptionFillResult = {
  filled: true;
  attempts: number;
  writtenLength: number;
  strategy: string;
};

function normalizeText(
  value: string | null | undefined,
) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function visible(
  locator: Locator,
) {
  return locator
    .isVisible()
    .catch(() => false);
}

export async function resetFacebookComposer(
  page: Page,
) {
  const dialogs =
    page.locator(
      '[role="dialog"]',
    );

  const count =
    await dialogs
      .count()
      .catch(() => 0);

  let composerFound =
    false;

  for (
    let index = count - 1;
    index >= 0;
    index -= 1
  ) {
    const dialog =
      dialogs.nth(index);

    if (
      !await visible(dialog)
    ) {
      continue;
    }

    const hasEditor =
      await dialog
        .locator(
          '[contenteditable="true"][role="textbox"]',
        )
        .count()
        .catch(() => 0);

    const text =
      normalizeText(
        await dialog
          .innerText()
          .catch(() => ""),
      );

    if (
      hasEditor > 0 &&
      (
        /create post/i.test(text) ||
        /what'?s on your mind/i.test(text)
      )
    ) {
      composerFound =
        true;
      break;
    }
  }

  if (!composerFound) {
    return {
      reset: false,
    };
  }

  await page.reload({
    waitUntil:
      "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(
    1200,
  );

  return {
    reset: true,
  };
}


export async function findFacebookCreatePostDialog(
  page: Page,
  timeoutMs = 10000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const dialogs =
      page.locator(
        '[role="dialog"]',
      );

    const count =
      await dialogs
        .count()
        .catch(() => 0);

    for (
      let index = count - 1;
      index >= 0;
      index -= 1
    ) {
      /*
       * Keep the concrete nth(index) locator. Facebook can append hidden
       * dialog nodes after the composer trigger; a live `.last()` locator
       * would then silently retarget the new hidden node.
       */
      const dialog =
        dialogs.nth(index);

      if (
        !await visible(dialog)
      ) {
        continue;
      }

      const text =
        normalizeText(
          await dialog
            .innerText()
            .catch(() => ""),
        );

      const heading =
        normalizeText(
          await dialog
            .getByRole("heading")
            .first()
            .innerText()
            .catch(() => ""),
        );

      if (
        /create post/i.test(
          heading,
        ) ||
        /create post/i.test(
          text,
        ) ||
        /what'?s on your mind/i.test(
          text,
        )
      ) {
        return dialog;
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    "Facebook Create post dialog was not found after the composer trigger opened.",
  );
}

async function collectEditorCandidates(
  dialog: Locator,
) {
  return [
    {
      strategy:
        "aria-label",
      locator:
        dialog.locator(
          '[contenteditable="true"][role="textbox"][aria-label*="mind" i]',
        ),
    },
    {
      strategy:
        "aria-placeholder",
      locator:
        dialog.locator(
          '[contenteditable="true"][aria-placeholder*="mind" i]',
        ),
    },
    {
      strategy:
        "lexical-editor",
      locator:
        dialog.locator(
          '[contenteditable="true"][data-lexical-editor="true"]',
        ),
    },
    {
      strategy:
        "role-textbox",
      locator:
        dialog.locator(
          '[contenteditable="true"][role="textbox"]',
        ),
    },
    {
      strategy:
        "contenteditable",
      locator:
        dialog.locator(
          '[contenteditable="true"]',
        ),
    },
  ];
}

async function replaceEditorText(
  page: Page,
  editor: Locator,
  caption: string,
) {
  await editor
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);

  await editor.click({
    force: true,
    timeout: 5000,
  });

  await editor.evaluate(
    (
      element,
      value,
    ) => {
      const html =
        element as HTMLElement;

      html.focus();

      const selection =
        window.getSelection();

      const range =
        document.createRange();

      range.selectNodeContents(
        html,
      );

      selection?.removeAllRanges();
      selection?.addRange(
        range,
      );

      document.execCommand(
        "delete",
        false,
      );

      const beforeInput =
        new InputEvent(
          "beforeinput",
          {
            bubbles: true,
            cancelable: true,
            inputType:
              "insertText",
            data: value,
          },
        );

      html.dispatchEvent(
        beforeInput,
      );

      document.execCommand(
        "insertText",
        false,
        value,
      );

      const input =
        new InputEvent(
          "input",
          {
            bubbles: true,
            inputType:
              "insertText",
            data: value,
          },
        );

      html.dispatchEvent(
        input,
      );

      html.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true,
          },
        ),
      );
    },
    caption,
  );

  await page.waitForTimeout(
    700,
  );
}


async function editorContainsCaption(
  editor: Locator,
  caption: string,
) {
  const innerText =
    normalizeText(
      await editor
        .innerText()
        .catch(() => ""),
    );

  const textContent =
    normalizeText(
      await editor
        .textContent()
        .catch(() => ""),
    );

  const expected =
    normalizeText(
      caption,
    );

  return {
    matched:
      innerText.includes(expected) ||
      textContent.includes(expected),
    writtenLength:
      Math.max(
        innerText.length,
        textContent.length,
      ),
  };
}

export async function fillFacebookComposerCaption(
  page: Page,
  caption: string,
): Promise<CaptionFillResult> {
  const expected =
    caption.trim();

  if (!expected) {
    throw new Error(
      "Facebook caption cannot be empty.",
    );
  }

  for (
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
    const editors =
      page.locator(
        '[role="dialog"] [contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-placeholder*="mind" i]',
      );

    const count =
      await editors
        .count()
        .catch(() => 0);

    const visibleEditors:
      Locator[] = [];

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
        visibleEditors.push(
          editor,
        );
      }
    }

    if (
      visibleEditors.length === 0
    ) {
      await page.waitForTimeout(
        700,
      );
      continue;
    }

    /*
     * Facebook may keep an older Composer editor
     * mounted behind the current dialog.
     * The last visible editor matches the active
     * Composer used by the verified debug route.
     */
    const editor =
      visibleEditors[
        visibleEditors.length - 1
      ];

    await editor.fill(
      expected,
      {
        force: true,
      },
    );

    await page.waitForTimeout(
      1000,
    );

    const verification =
      await editorContainsCaption(
        editor,
        expected,
      );

    if (
      verification.matched
    ) {
      return {
        filled: true,
        attempts:
          attempt,
        writtenLength:
          verification.writtenLength,
        strategy:
          "playwright-contenteditable-fill",
      };
    }

    await page.waitForTimeout(
      700,
    );
  }

  throw new Error(
    "Facebook caption could not be verified after 3 attempts.",
  );
}

export async function countFacebookComposerImagePreviews(
  dialog: Locator,
): Promise<number> {
  const inspection =
    await inspectFacebookComposerImagePreviews(
      dialog,
    );

  return inspection.count;
}

export type FacebookComposerImagePreviewCandidate = {
  tagName: string;
  role: string | null;
  sourceType:
    | "IMG"
    | "BACKGROUND"
    | "NONE";
  source: string;
  display: string;
  visibility: string;
  opacity: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
};

export function isFacebookComposerImagePreviewCandidate(
  candidate: FacebookComposerImagePreviewCandidate,
) {
  const visible =
    candidate.display !== "none" &&
    candidate.visibility !== "hidden" &&
    candidate.opacity > 0 &&
    candidate.width >= 100 &&
    candidate.height >= 100;

  if (!visible || !candidate.source) {
    return false;
  }

  if (candidate.sourceType === "BACKGROUND") {
    return candidate.source !== "none";
  }

  return (
    candidate.sourceType === "IMG" &&
    candidate.naturalWidth >= 100 &&
    candidate.naturalHeight >= 100
  );
}

export function normalizeFacebookComposerImagePreviewSource(
  value: string,
) {
  const normalized = value.trim();
  const cssUrlMatch =
    normalized.match(
      /^url\((?:["']?)(.*?)(?:["']?)\)$/i,
    );

  return (
    cssUrlMatch?.[1]?.trim() ||
    normalized
  );
}

export function countFacebookComposerImagePreviewCandidates(
  candidates: FacebookComposerImagePreviewCandidate[],
) {
  const uniqueSources = new Set(
    candidates
      .filter(
        isFacebookComposerImagePreviewCandidate,
      )
      .map(
        (candidate) =>
          normalizeFacebookComposerImagePreviewSource(
            candidate.source,
          ),
      )
      .filter(Boolean),
  );

  return uniqueSources.size;
}

export async function inspectFacebookComposerImagePreviews(
  dialog: Locator,
) {
  const candidates =
    await dialog
      .locator(
        [
          "img",
          '[role="img"]',
          '[style*="background-image"]',
          '[data-visualcompletion="media-vc-image"]',
        ].join(","),
      )
    .evaluateAll(
      (elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const image =
            element instanceof HTMLImageElement
              ? element
              : null;
          const imageSource =
            image?.currentSrc ||
            image?.src ||
            "";
          const backgroundSource =
            style.backgroundImage &&
            style.backgroundImage !== "none"
              ? style.backgroundImage
              : "";

          return {
            tagName:
              element.tagName,
            role:
              element.getAttribute("role"),
            sourceType:
              imageSource
                ? "IMG"
                : backgroundSource
                  ? "BACKGROUND"
                  : "NONE",
            source:
              imageSource || backgroundSource,
            display:
              style.display,
            visibility:
              style.visibility,
            opacity:
              Number(style.opacity || "1"),
            width:
              rect.width,
            height:
              rect.height,
            naturalWidth:
              image?.naturalWidth || 0,
            naturalHeight:
              image?.naturalHeight || 0,
          };
        }),
    )
    .then(
      (values) =>
        values as FacebookComposerImagePreviewCandidate[],
    )
    .catch(
      () => [] as FacebookComposerImagePreviewCandidate[],
    );

  return {
    count:
      countFacebookComposerImagePreviewCandidates(
        candidates,
      ),
    candidates:
      candidates
        .slice(0, 20)
        .map((candidate) => ({
          ...candidate,
          source:
            candidate.source.slice(
              0,
              180,
            ),
          accepted:
            isFacebookComposerImagePreviewCandidate(
              candidate,
            ),
        })),
  };
}

export async function waitForFacebookComposerImagePreviews(
  dialog: Locator,
  input: {
    baselineCount: number;
    expectedAddedCount: number;
    timeoutMs?: number;
  },
) {
  const expectedCount = input.baselineCount + input.expectedAddedCount;
  const timeoutMs = input.timeoutMs ?? 20000;
  const startedAt = Date.now();
  let previewCount = input.baselineCount;
  let previewCandidates:
    Awaited<
      ReturnType<
        typeof inspectFacebookComposerImagePreviews
      >
    >["candidates"] = [];

  while (Date.now() - startedAt < timeoutMs) {
    const inspection =
      await inspectFacebookComposerImagePreviews(
        dialog,
      );

    previewCount = inspection.count;
    previewCandidates = inspection.candidates;

    if (previewCount >= expectedCount) {
      return {
        attached: true,
        previewCount,
        addedCount: previewCount - input.baselineCount,
        waitedMs: Date.now() - startedAt,
        previewCandidates,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return {
    attached: false,
    previewCount,
    addedCount: Math.max(0, previewCount - input.baselineCount),
    waitedMs: Date.now() - startedAt,
    previewCandidates,
  };
}

export async function waitForFacebookComposerStable(page: Page) {
  let previousSignature = "";

  let stableChecks = 0;

  const startedAt =
    Date.now();

  for (
    let attempt = 0;
    attempt < 30;
    attempt += 1
  ) {
    const dialogs =
      page.locator(
        '[role="dialog"]',
      );

    const count =
      await dialogs
        .count()
        .catch(() => 0);

    let signature = "";

    let ready =
      false;

    for (
      let index = count - 1;
      index >= 0;
      index -= 1
    ) {
      const dialog =
        dialogs.nth(index);

      if (
        !await dialog
          .isVisible()
          .catch(() => false)
      ) {
        continue;
      }

      const editor =
        dialog.locator(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
        );

      const editorCount =
        await editor
          .count()
          .catch(() => 0);

      if (
        editorCount === 0
      ) {
        continue;
      }

      const images =
        await dialog
          .locator("img")
          .count()
          .catch(() => 0);

      const postButtonVisible =
        await dialog
          .getByRole(
            "button",
            {
              name: /^(post|publish)(?: now)?$/i,
            },
          )
          .first()
          .isVisible()
          .catch(() => false);

      const mediaControlVisible =
        await dialog
          .getByText(
            /photo\/video|add photo|add video|add reel/i,
          )
          .first()
          .isVisible()
          .catch(() => false);

      const editorTextLength =
        normalizeText(
          await editor
            .first()
            .innerText()
            .catch(() => ""),
        ).length;

      const text =
        (
          await dialog
            .innerText()
            .catch(() => "")
        )
          .replace(
            /\s+/g,
            " ",
          )
          .trim();

      const loading =
        /uploading|processing|please wait/i
          .test(text);

      const hasPostButton =
        text.includes(
          "Post",
        ) ||
        postButtonVisible;

      const hasComposer =
        text.includes(
          "Add to your post",
        ) ||
        mediaControlVisible;

      ready =
        !loading &&
        (
          hasComposer ||
          hasPostButton
        );

      signature =
        [
          editorCount,
          images,
          loading,
          hasComposer,
          hasPostButton,
          editorTextLength,
        ].join(":");

      break;
    }

    if (
      signature &&
      signature ===
        previousSignature
    ) {
      stableChecks += 1;
    } else {
      stableChecks = 0;
    }

    previousSignature =
      signature;

    if (
      ready &&
      stableChecks >= 1
    ) {
      return {
        stable: true,
        signature,
        checks:
          attempt + 1,
        durationMs:
          Date.now() -
          startedAt,
      };
    }

    await page.waitForTimeout(
      300,
    );
  }

  throw new Error(
    "Facebook Composer did not become stable.",
  );
}
