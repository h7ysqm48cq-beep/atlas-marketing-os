import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureFacebookPageIdentitySwitch,
  extractFacebookPageSwitchTargetName,
  facebookPageSwitchActionPattern,
  hasFacebookPageTargetIdentityEvidence,
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

test("extracts the target Page name from current and legacy prompts", () => {
  assert.equal(
    extractFacebookPageSwitchTargetName(
      "Switch into 专治你没瓜看's Page to take more actions Switch",
    ),
    "专治你没瓜看",
  );
  assert.equal(
    extractFacebookPageSwitchTargetName(
      "Switch into MGM满贯门SportsNews Switch now",
    ),
    "MGM满贯门SportsNews",
  );
});

test("requires the target Page name as post-switch identity evidence", () => {
  assert.equal(
    hasFacebookPageTargetIdentityEvidence(
      "Manage Page 专治你没瓜看 Create post",
      "专治你没瓜看",
    ),
    true,
  );
  assert.equal(
    hasFacebookPageTargetIdentityEvidence(
      "Facebook Home Create post",
      "专治你没瓜看",
    ),
    false,
  );
});

test("does not click when Page identity switching is not required", async () => {
  let clicks = 0;

  const result =
    await ensureFacebookPageIdentitySwitch({
      inspectState: async () => ({
        bodyText: "Manage Page M Story Create post",
        hasVisibleSwitchAction: false,
      }),
      clickSwitchAction: async () => {
        clicks += 1;
        return true;
      },
      waitForSettled: async () => undefined,
    });

  assert.equal(result.verified, true);
  assert.equal(result.required, false);
  assert.equal(result.reason, "NOT_REQUIRED");
  assert.equal(clicks, 0);
});

test("verifies a Page identity switch after the prompt disappears", async () => {
  let stateIndex = 0;
  let clicks = 0;
  const states = [
    {
      bodyText:
        "Switch into 专治你没瓜看's Page to take more actions Switch",
      hasVisibleSwitchAction: true,
    },
    {
      bodyText: "Manage Page 专治你没瓜看 Create post",
      hasVisibleSwitchAction: false,
    },
  ];

  const result =
    await ensureFacebookPageIdentitySwitch({
      inspectState: async () => states[stateIndex],
      clickSwitchAction: async () => {
        clicks += 1;
        return true;
      },
      waitForSettled: async () => {
        stateIndex += 1;
      },
    });

  assert.equal(result.verified, true);
  assert.equal(result.reason, "VERIFIED");
  assert.equal(result.attempts, 1);
  assert.equal(result.targetPageName, "专治你没瓜看");
  assert.equal(clicks, 1);
});

test("handles a second Facebook Page switch confirmation", async () => {
  let stateIndex = 0;
  let clicks = 0;
  const states = [
    {
      bodyText:
        "Switch into MGM满贯门SportsNews's Page to take more actions Switch",
      hasVisibleSwitchAction: true,
    },
    {
      bodyText: "Confirm that you want to continue as this Page Switch now",
      hasVisibleSwitchAction: true,
    },
    {
      bodyText: "Manage Page MGM满贯门SportsNews Create post",
      hasVisibleSwitchAction: false,
    },
  ];

  const result =
    await ensureFacebookPageIdentitySwitch({
      inspectState: async () => states[stateIndex],
      clickSwitchAction: async () => {
        clicks += 1;
        return true;
      },
      waitForSettled: async () => {
        stateIndex += 1;
      },
    });

  assert.equal(result.verified, true);
  assert.equal(result.reason, "VERIFIED");
  assert.equal(result.attempts, 2);
  assert.equal(result.targetPageName, "MGM满贯门SportsNews");
  assert.equal(clicks, 2);
});

test("fails closed when Facebook keeps the identity switch pending", async () => {
  let clicks = 0;
  const pendingState = {
    bodyText:
      "Switch into 专治你没瓜看's Page to take more actions Switch",
    hasVisibleSwitchAction: true,
  };

  const result =
    await ensureFacebookPageIdentitySwitch({
      inspectState: async () => pendingState,
      clickSwitchAction: async () => {
        clicks += 1;
        return true;
      },
      waitForSettled: async () => undefined,
      maxAttempts: 3,
    });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "SWITCH_STILL_PENDING");
  assert.equal(result.attempts, 3);
  assert.equal(clicks, 3);
});

test("fails closed when the target Page identity cannot be verified", async () => {
  let stateIndex = 0;
  const states = [
    {
      bodyText:
        "Switch into 专治你没瓜看's Page to take more actions Switch",
      hasVisibleSwitchAction: true,
    },
    {
      bodyText: "Facebook Home Create post",
      hasVisibleSwitchAction: false,
    },
  ];

  const result =
    await ensureFacebookPageIdentitySwitch({
      inspectState: async () => states[stateIndex],
      clickSwitchAction: async () => true,
      waitForSettled: async () => {
        stateIndex += 1;
      },
    });

  assert.equal(result.verified, false);
  assert.equal(
    result.reason,
    "TARGET_IDENTITY_NOT_VERIFIED",
  );
  assert.equal(result.attempts, 1);
});

test("fails closed when the Page switch action cannot be found", async () => {
  const result =
    await ensureFacebookPageIdentitySwitch({
      inspectState: async () => ({
        bodyText:
          "Switch into 专治你没瓜看's Page to take more actions",
        hasVisibleSwitchAction: false,
      }),
      clickSwitchAction: async () => false,
      waitForSettled: async () => undefined,
    });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "ACTION_NOT_FOUND");
  assert.equal(result.attempts, 0);
});
