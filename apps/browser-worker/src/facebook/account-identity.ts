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

  try {
    tab = await input.openTemporaryTab();

    await tab.goto(
      `https://www.facebook.com/profile.php?id=${encodeURIComponent(
        facebookUserId,
      )}`,
    );

    const facebookUserName =
      normalizeFacebookProfileName(
        await tab.readProfileName(),
      );

    return {
      facebookUserId,
      facebookUserName,
    };
  } catch {
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
