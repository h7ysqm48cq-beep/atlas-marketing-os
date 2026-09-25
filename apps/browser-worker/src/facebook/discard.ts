export type FacebookDiscardAfterCloseResult =
  | {
      ok: true;
      confirmationObserved: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export function resolveFacebookDiscardAfterClose(input: {
  discardConfirmed: boolean;
  composerStillVisible: boolean;
}): FacebookDiscardAfterCloseResult {
  if (input.composerStillVisible) {
    return {
      ok: false,
      message: input.discardConfirmed
        ? "Facebook composer remained visible after discard."
        : "Facebook Delete draft confirmation button was not found and composer remained visible.",
    };
  }

  return {
    ok: true,
    confirmationObserved: input.discardConfirmed,
  };
}
