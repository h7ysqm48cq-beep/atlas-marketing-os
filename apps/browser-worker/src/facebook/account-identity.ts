export type FacebookCookie = {
  name: string;
  value: string;
};

export type FacebookIdentityTab = {
  goto: (url: string) => Promise<void>;
  readProfileName: () => Promise<string | null>;
  close: () => Promise<void>;
};

export type FacebookAccountIdentity = {
  facebookUserId: string;
  facebookUserName: string | null;
};

export function normalizeFacebookProfileName(
  value: string | null | undefined,
): string | null {
  const normalized =
    value
      ?.replace(/\s+/g, " ")
      .trim() || "";

  if (!normalized) {
    return null;
  }

  const withoutNotificationCount =
    normalized
      .replace(
        /^\(\d+\+?\)\s*/u,
        "",
      )
      .trim();

  const rejectedNames =
    new Set([
      "facebook",
      "home",
      "profile",
      "notifications",
      "notification",
      "menu",
      "facebook home",
      "log in",
      "login",
    ]);

  if (
    rejectedNames.has(
      withoutNotificationCount.toLowerCase(),
    )
  ) {
    return null;
  }

  return withoutNotificationCount || null;
}

export async function inspectFacebookAccountIdentity(input: {
  getCookies: () => Promise<FacebookCookie[]>;
  captureProfileName?: boolean;
  openTemporaryTab: () => Promise<FacebookIdentityTab>;
}): Promise<FacebookAccountIdentity | null> {
  let facebookUserId = "";

  try {
    const cookies = await input.getCookies();

    facebookUserId =
      cookies
        .find((cookie) => cookie.name === "c_user")
        ?.value
        .trim() || "";
  } catch {
    return null;
  }

  if (!facebookUserId) {
    return null;
  }

  if (input.captureProfileName === false) {
    return {
      facebookUserId,
      facebookUserName: null,
    };
  }

  let tab: FacebookIdentityTab | null = null;
  let captureStage = "open-tab";

  try {
    tab = await input.openTemporaryTab();

    captureStage = "goto";

    await tab.goto(
      `https://www.facebook.com/profile.php?id=${encodeURIComponent(
        facebookUserId,
      )}`,
    );

    captureStage = "read-1";

    const firstRawProfileName =
      await tab.readProfileName();

    let facebookUserName =
      normalizeFacebookProfileName(
        firstRawProfileName,
      );

    console.info(
      "[facebook/account-identity-profile-name-attempt]",
      {
        facebookUserId,
        attempt: 1,
        rawProfileName:
          firstRawProfileName,
        normalizedProfileName:
          facebookUserName,
      },
    );

    if (!facebookUserName) {
      captureStage = "read-2";

      const secondRawProfileName =
        await tab.readProfileName();

      facebookUserName =
        normalizeFacebookProfileName(
          secondRawProfileName,
        );

      console.info(
        "[facebook/account-identity-profile-name-attempt]",
        {
          facebookUserId,
          attempt: 2,
          rawProfileName:
            secondRawProfileName,
          normalizedProfileName:
            facebookUserName,
        },
      );
    }

    return {
      facebookUserId,
      facebookUserName,
    };
  } catch (error) {
    console.warn(
      "[facebook/account-identity-profile-name-failure]",
      {
        facebookUserId,
        stage: captureStage,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );

    return {
      facebookUserId,
      facebookUserName: null,
    };
  } finally {
    if (tab) {
      try {
        await tab.close();
      } catch {
        // Identity inspection must never break the main browser session.
      }
    }
  }
}
