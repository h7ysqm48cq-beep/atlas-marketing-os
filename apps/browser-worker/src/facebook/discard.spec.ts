import assert from "node:assert/strict";
import test from "node:test";
import { resolveFacebookDiscardAfterClose } from "./discard.js";

test("accepts a confirmed discard after the composer closes", () => {
  assert.deepEqual(
    resolveFacebookDiscardAfterClose({
      discardConfirmed: true,
      composerStillVisible: false,
    }),
    {
      ok: true,
      confirmationObserved: true,
    },
  );
});

test("accepts Facebook closing the composer without a discard confirmation", () => {
  assert.deepEqual(
    resolveFacebookDiscardAfterClose({
      discardConfirmed: false,
      composerStillVisible: false,
    }),
    {
      ok: true,
      confirmationObserved: false,
    },
  );
});

test("fails closed when confirmation is absent and the composer remains visible", () => {
  assert.deepEqual(
    resolveFacebookDiscardAfterClose({
      discardConfirmed: false,
      composerStillVisible: true,
    }),
    {
      ok: false,
      message:
        "Facebook Delete draft confirmation button was not found and composer remained visible.",
    },
  );
});
