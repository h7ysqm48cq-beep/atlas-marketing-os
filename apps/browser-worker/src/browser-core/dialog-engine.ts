import type {
  Locator,
  Page,
} from "playwright-core";

export type DialogAction = {
  iteration: number;
  dialogTitle: string | null;
  dialogTextPreview: string;
  buttonText: string;
  strategy:
    | "role-button"
    | "text-button"
    | "dom-click";
};

export type DialogEngineResult = {
  handled: boolean;
  actions: DialogAction[];
  stoppedReason:
    | "NO_DIALOG"
    | "NO_SAFE_ACTION"
    | "MAX_ITERATIONS"
    | "DANGEROUS_ACTION"
    | null;
  remainingDialog: {
    title: string | null;
    textPreview: string;
  } | null;
};

type DialogEngineOptions = {
  maxIterations?: number;
  waitAfterActionMs?: number;
};

const SAFE_ACTION_PATTERNS: RegExp[] = [
  /^continue$/i,
  /^save$/i,
  /^next$/i,
  /^done$/i,
  /^got it$/i,
  /^ok$/i,
  /^okay$/i,
  /^not now$/i,
  /^skip$/i,
  /^maybe later$/i,
  /^close$/i,
  /^dismiss$/i,
  /^accept$/i,
  /^allow$/i,
];

const DANGEROUS_ACTION_PATTERNS: RegExp[] = [
  /^post$/i,
  /^publish$/i,
  /^share$/i,
  /^send$/i,
  /^submit$/i,
  /^delete$/i,
  /^remove$/i,
  /^confirm$/i,
  /^buy$/i,
  /^pay$/i,
];

function normalizeText(
  value: string | null | undefined,
) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function isVisible(
  locator: Locator,
) {
  return locator
    .isVisible()
    .catch(() => false);
}

async function getDialogTitle(
  dialog: Locator,
) {
  const heading =
    dialog
      .getByRole("heading")
      .first();

  if (
    await isVisible(
      heading,
    )
  ) {
    const text =
      normalizeText(
        await heading
          .innerText()
          .catch(() => ""),
      );

    if (text) {
      return text;
    }
  }

  const ariaLabel =
    normalizeText(
      await dialog
        .getAttribute(
          "aria-label",
        )
        .catch(() => null),
    );

  return ariaLabel || null;
}

async function clickLocator(
  locator: Locator,
) {
  const roleClicked =
    await locator
      .click({
        force: true,
        timeout: 5000,
      })
      .then(() => true)
      .catch(() => false);

  if (roleClicked) {
    return true;
  }

  return locator
    .evaluate(
      (element) => {
        (
          element as HTMLElement
        ).click();
      },
    )
    .then(() => true)
    .catch(() => false);
}

async function findDangerousAction(
  dialog: Locator,
) {
  for (
    const pattern
    of DANGEROUS_ACTION_PATTERNS
  ) {
    const candidate =
      dialog
        .getByRole(
          "button",
          {
            name: pattern,
          },
        )
        .first();

    if (
      await isVisible(
        candidate,
      )
    ) {
      return pattern.source;
    }
  }

  return null;
}

async function clickSafeAction(
  dialog: Locator,
) {
  for (
    const pattern
    of SAFE_ACTION_PATTERNS
  ) {
    const roleButton =
      dialog
        .getByRole(
          "button",
          {
            name: pattern,
          },
        )
        .first();

    if (
      await isVisible(
        roleButton,
      )
    ) {
      const buttonText =
        normalizeText(
          await roleButton
            .innerText()
            .catch(() => ""),
        ) ||
        pattern.source;

      if (
        await clickLocator(
          roleButton,
        )
      ) {
        return {
          buttonText,
          strategy:
            "role-button" as const,
        };
      }
    }

    const textButton =
      dialog
        .getByText(
          pattern,
          {
            exact: true,
          },
        )
        .first();

    if (
      await isVisible(
        textButton,
      )
    ) {
      const buttonText =
        normalizeText(
          await textButton
            .innerText()
            .catch(() => ""),
        ) ||
        pattern.source;

      if (
        await clickLocator(
          textButton,
        )
      ) {
        return {
          buttonText,
          strategy:
            "text-button" as const,
        };
      }
    }
  }

  return null;
}

export async function handleDialogs(
  page: Page,
  options: DialogEngineOptions = {},
): Promise<DialogEngineResult> {
  const maxIterations =
    options.maxIterations ?? 8;

  const waitAfterActionMs =
    options.waitAfterActionMs ??
    900;

  const actions:
    DialogAction[] = [];

  let stoppedReason:
    DialogEngineResult["stoppedReason"] =
      null;

  for (
    let iteration = 1;
    iteration <= maxIterations;
    iteration += 1
  ) {
    const dialogs =
      page.locator(
        '[role="dialog"]',
      );

    const count =
      await dialogs
        .count()
        .catch(() => 0);

    let dialog:
      Locator | null = null;

    for (
      let index = count - 1;
      index >= 0;
      index -= 1
    ) {
      const candidate =
        dialogs.nth(
          index,
        );

      if (
        await isVisible(
          candidate,
        )
      ) {
        dialog =
          candidate;
        break;
      }
    }

    if (!dialog) {
      stoppedReason =
        actions.length
          ? "NO_DIALOG"
          : "NO_DIALOG";
      break;
    }

    const dialogText =
      normalizeText(
        await dialog
          .innerText()
          .catch(() => ""),
      );

    const dialogTitle =
      await getDialogTitle(
        dialog,
      );

    const dangerousAction =
      await findDangerousAction(
        dialog,
      );

    const safeAction =
      await clickSafeAction(
        dialog,
      );

    if (safeAction) {
      actions.push({
        iteration,
        dialogTitle,
        dialogTextPreview:
          dialogText.slice(
            0,
            500,
          ),
        buttonText:
          safeAction.buttonText,
        strategy:
          safeAction.strategy,
      });

      await page.waitForTimeout(
        waitAfterActionMs,
      );

      continue;
    }

    if (dangerousAction) {
      stoppedReason =
        "DANGEROUS_ACTION";
      break;
    }

    stoppedReason =
      "NO_SAFE_ACTION";
    break;
  }

  if (
    actions.length >=
      maxIterations &&
    !stoppedReason
  ) {
    stoppedReason =
      "MAX_ITERATIONS";
  }

  const remainingDialog =
    page
      .locator(
        '[role="dialog"]',
      )
      .last();

  const remainingVisible =
    await isVisible(
      remainingDialog,
    );

  return {
    handled:
      actions.length > 0,
    actions,
    stoppedReason,
    remainingDialog:
      remainingVisible
        ? {
            title:
              await getDialogTitle(
                remainingDialog,
              ),
            textPreview:
              normalizeText(
                await remainingDialog
                  .innerText()
                  .catch(
                    () => "",
                  ),
              ).slice(
                0,
                500,
              ),
          }
        : null,
  };
}
