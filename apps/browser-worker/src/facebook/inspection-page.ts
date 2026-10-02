export type FacebookInspectionTab = {
  url: string;
  loginRequired: boolean;
  challenge?: boolean;
};

function isFacebookUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    return (
      hostname === "facebook.com" ||
      hostname === "www.facebook.com" ||
      hostname.endsWith(".facebook.com")
    );
  } catch {
    return false;
  }
}

function isFacebookChallenge(url: string, text: string) {
  const normalizedUrl = url.toLowerCase();
  const normalizedText = text.toLowerCase();

  return (
    normalizedUrl.includes("/checkpoint") ||
    normalizedUrl.includes("two_step_verification") ||
    normalizedText.includes("security check") ||
    normalizedText.includes("confirm your identity") ||
    normalizedText.includes("authentication code") ||
    normalizedText.includes("two-factor authentication") ||
    normalizedText.includes("enter the code")
  );
}

export function classifyFacebookInspectionTab(input: {
  url: string;
  text: string;
  hasVisiblePassword: boolean;
}) {
  const normalizedUrl = input.url.toLowerCase();
  const normalizedText = input.text.toLowerCase();
  const loginRequired =
    normalizedUrl.includes("facebook.com/login") ||
    input.hasVisiblePassword ||
    (normalizedText.includes("log in") &&
      normalizedText.includes("password"));

  return {
    facebook: isFacebookUrl(input.url),
    loginRequired,
    challenge: isFacebookChallenge(
      input.url,
      input.text,
    ),
    ready:
      isFacebookUrl(input.url) &&
      !loginRequired &&
      !isFacebookChallenge(input.url, input.text),
  };
}

export function selectFacebookInspectionTab(
  tabs: FacebookInspectionTab[],
) {
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const tab = tabs[index];

    if (
      isFacebookUrl(tab.url) &&
      !tab.loginRequired &&
      !tab.challenge
    ) {
      return index;
    }
  }

  return tabs.length > 0 ? tabs.length - 1 : -1;
}
