export const facebookPageSwitchActionPattern =
  /^switch(?: now)?$/i;

export type FacebookPageIdentitySwitchState = {
  bodyText: string;
  hasVisibleSwitchAction: boolean;
};

export type FacebookPageIdentitySwitchResult = {
  required: boolean;
  verified: boolean;
  attempts: number;
  targetPageName: string | null;
  reason:
    | "NOT_REQUIRED"
    | "VERIFIED"
    | "ACTION_NOT_FOUND"
    | "TARGET_IDENTITY_NOT_VERIFIED"
    | "SWITCH_STILL_PENDING";
};

export function hasFacebookPageSwitchPrompt(
  value: string,
) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    normalized.includes(
      "switch into",
    ) &&
    (
      normalized.includes(
        "switch now",
      ) ||
      normalized.includes(
        "page to take more actions",
      )
    )
  );
}

export function extractFacebookPageSwitchTargetName(
  value: string,
) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();

  const currentPromptMatch =
    normalized.match(
      /switch into\s+(.+?)(?:['’]s\s+page|\s+page)\s+to take more actions/i,
    );

  if (currentPromptMatch?.[1]) {
    return currentPromptMatch[1].trim();
  }

  const legacyPromptMatch =
    normalized.match(
      /switch into\s+(.+?)\s+switch now/i,
    );

  return legacyPromptMatch?.[1]?.trim() || null;
}

export function hasFacebookPageTargetIdentityEvidence(
  value: string,
  targetPageName: string,
) {
  const normalizedValue = value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
  const normalizedTargetPageName =
    targetPageName
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();

  return (
    normalizedTargetPageName.length > 0 &&
    normalizedValue.includes(
      normalizedTargetPageName,
    )
  );
}

export async function ensureFacebookPageIdentitySwitch(
  input: {
    inspectState: () => Promise<FacebookPageIdentitySwitchState>;
    clickSwitchAction: () => Promise<boolean>;
    waitForSettled: () => Promise<void>;
    maxAttempts?: number;
  },
): Promise<FacebookPageIdentitySwitchResult> {
  let state = await input.inspectState();

  if (!hasFacebookPageSwitchPrompt(state.bodyText)) {
    return {
      required: false,
      verified: true,
      attempts: 0,
      targetPageName: null,
      reason: "NOT_REQUIRED",
    };
  }

  const targetPageName =
    extractFacebookPageSwitchTargetName(
      state.bodyText,
    );
  const maxAttempts = Math.max(
    1,
    input.maxAttempts ?? 3,
  );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const clicked =
      await input.clickSwitchAction();

    if (!clicked) {
      return {
        required: true,
        verified: false,
        attempts: attempt - 1,
        targetPageName,
        reason: "ACTION_NOT_FOUND",
      };
    }

    await input.waitForSettled();
    state = await input.inspectState();

    const switchStillPending =
      hasFacebookPageSwitchPrompt(
        state.bodyText,
      ) ||
      state.hasVisibleSwitchAction;

    if (!switchStillPending) {
      if (
        targetPageName &&
        !hasFacebookPageTargetIdentityEvidence(
          state.bodyText,
          targetPageName,
        )
      ) {
        return {
          required: true,
          verified: false,
          attempts: attempt,
          targetPageName,
          reason:
            "TARGET_IDENTITY_NOT_VERIFIED",
        };
      }

      return {
        required: true,
        verified: true,
        attempts: attempt,
        targetPageName,
        reason: "VERIFIED",
      };
    }
  }

  return {
    required: true,
    verified: false,
    attempts: maxAttempts,
    targetPageName,
    reason: "SWITCH_STILL_PENDING",
  };
}
