import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookPageSwitchActionPattern,
  hasFacebookPageSwitchPrompt,
} from "./page-identity.js";

test("matches both Facebook Page identity switch labels", () => {
  assert.equal(
    facebookPageSwitchActionPattern.test(
      "Switch",
    ),
    true,
  );
  assert.equal(
    facebookPageSwitchActionPattern.test(
      "Switch now",
    ),
    true,
  );
});

test("does not match unrelated Facebook switch actions", () => {
  assert.equal(
    facebookPageSwitchActionPattern.test(
      "Switch profile",
    ),
    false,
  );
  assert.equal(
    facebookPageSwitchActionPattern.test(
      "Switch into M Story",
    ),
    false,
  );
});

test("recognizes the current Facebook Page switch prompt", () => {
  assert.equal(
    hasFacebookPageSwitchPrompt(
      "Switch into 专治你没瓜看's Page to take more actions Switch Advertise",
    ),
    true,
  );
});

test("keeps compatibility with the previous Switch now prompt", () => {
  assert.equal(
    hasFacebookPageSwitchPrompt(
      "Switch into 专治你没瓜看 Switch now",
    ),
    true,
  );
});

test("does not classify unrelated Facebook copy as a Page switch prompt", () => {
  assert.equal(
    hasFacebookPageSwitchPrompt(
      "Use the Facebook menu to switch profiles",
    ),
    false,
  );
});
