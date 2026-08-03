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

  let composer:
    Locator | null =
    null;

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

    if (!hasEditor) {
      continue;
    }

    const text =
      normalizeText(
        await dialog
          .innerText()
          .catch(() => ""),
      );

    if (
      /create post/i.test(text) ||
      /what'?s on your mind/i.test(text)
    ) {
      composer =
        dialog;
      break;
    }
  }

  if (!composer) {
    return {
      reset: false,
      strategy:
        "NO_EXISTING_COMPOSER",
    };
  }

  const closeCandidates = [
    composer.getByRole(
      "button",
      {
        name:
          /^close$/i,
      },
    ),
    composer.locator(
      '[aria-label="Close"]',
    ),
    composer.locator(
      '[role="button"][aria-label*="Close" i]',
    ),
  ];

  let closeClicked =
    false;

  for (
    const candidate
    of closeCandidates
  ) {
    const button =
      candidate.first();

    if (
      !await visible(button)
    ) {
      continue;
    }

    closeClicked =
      await button
        .click({
          force: true,
          timeout: 1500,
        })
        .then(() => true)
        .catch(() => false);

    if (closeClicked) {
      break;
    }
  }

  if (closeClicked) {
    const discardCandidates = [
      page.getByRole(
        "button",
        {
          name:
            /^delete draft$/i,
        },
      ),
      page.getByRole(
        "button",
        {
          name:
            /^discard$/i,
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

    const confirmationDeadline =
      Date.now() + 1800;

    while (
      Date.now() <
      confirmationDeadline
    ) {
      let confirmed =
        false;

      for (
        const candidate
        of discardCandidates
      ) {
        const button =
          candidate.last();

        if (
          !await visible(button)
        ) {
          continue;
        }

        confirmed =
          await button
            .click({
              force: true,
              timeout: 1000,
            })
            .then(() => true)
            .catch(() => false);

        if (confirmed) {
          break;
        }
      }

      if (confirmed) {
        break;
      }

      if (
        !await visible(composer)
      ) {
        return {
          reset: true,
          strategy:
            "CLOSE_WITHOUT_CONFIRMATION",
        };
      }

      await page.waitForTimeout(
        100,
      );
    }

    const hiddenDeadline =
      Date.now() + 1500;

    while (
      Date.now() <
      hiddenDeadline
    ) {
      if (
        !await visible(composer)
      ) {
        return {
          reset: true,
          strategy:
            "CLOSE_AND_DISCARD",
        };
      }

      await page.waitForTimeout(
        100,
      );
    }
  }

  /*
   * Fallback for unexpected Facebook UI states.
   * Reload is retained for reliability but is no
   * longer the normal reset strategy.
   */
  await page.reload({
    waitUntil:
      "domcontentloaded",
    timeout: 30000,
  });

  return {
    reset: true,
    strategy:
      "RELOAD_FALLBACK",
  };
}


async function findCreatePostDialog(
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

  throw new Error(
    "Facebook Create post dialog was not found.",
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


export async function waitForFacebookComposerStable(
  page: Page,
) {
  let previousSignature = "";

  let stableChecks = 0;

  const startedAt =
    Date.now();

  for (
    let attempt = 0;
    attempt < 12;
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
        );

      const hasComposer =
        text.includes(
          "Add to your post",
        );

      ready =
        !loading &&
        hasComposer;

      signature =
        [
          editorCount,
          images,
          loading,
          hasComposer,
          hasPostButton,
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
