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

export async function inspectFacebookAccountIdentity(input: {
  getCookies: () => Promise<FacebookCookie[]>;
  captureProfileName?: boolean;
  openTemporaryTab: () => Promise<FacebookIdentityTab>;
}): Promise<FacebookAccountIdentity | null> {
  let tab: FacebookIdentityTab | null = null;

  try {
    const cookies = await input.getCookies();

    const facebookUserId =
      cookies
        .find((cookie) => cookie.name === "c_user")
        ?.value
        .trim() || "";

    if (!facebookUserId) {
      return null;
    }

    if (input.captureProfileName === false) {
      return {
        facebookUserId,
        facebookUserName: null,
      };
    }

    tab = await input.openTemporaryTab();

    await tab.goto(
      `https://www.facebook.com/profile.php?id=${encodeURIComponent(
        facebookUserId,
      )}`,
    );

    const facebookUserName =
      (await tab.readProfileName())?.trim() || null;

    return {
      facebookUserId,
      facebookUserName,
    };
  } catch {
    return null;
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
