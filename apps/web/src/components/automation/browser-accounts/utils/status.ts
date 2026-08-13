import styles from "../../BrowserAccountsManagerV2.module.css";

export function normalizeStatus(
  value?: string | null,
) {
  return (
    value?.trim().toUpperCase() ||
    "UNKNOWN"
  );
}

export function readableStatus(
  value?: string | null,
) {
  return normalizeStatus(value).replaceAll("_", " ");
}

export function loginStatusClass(
  value?: string | null,
) {
  const normalized = normalizeStatus(value);

  if (normalized === "LOGGED_IN") {
    return styles.good;
  }

  if (
    normalized === "TWO_FACTOR_REQUIRED" ||
    normalized === "CHECKPOINT_REQUIRED"
  ) {
    return styles.warning;
  }

  if (
    normalized === "LOGIN_REQUIRED" ||
    normalized === "FAILED"
  ) {
    return styles.bad;
  }

  return styles.neutral;
}

export function healthStatusFromLogin(
  value?: string | null,
):
  | "READY"
  | "LOGIN_REQUIRED"
  | "ATTENTION"
  | "UNKNOWN" {
  const status = normalizeStatus(value);

  if (status === "LOGGED_IN") {
    return "READY";
  }

  if (status === "LOGIN_REQUIRED") {
    return "LOGIN_REQUIRED";
  }

  if (
    status === "TWO_FACTOR_REQUIRED" ||
    status === "CHECKPOINT_REQUIRED"
  ) {
    return "ATTENTION";
  }

  return "UNKNOWN";
}

export function facebookIdentityMessage(
  value?: string | null,
) {
  const status = normalizeStatus(value);

  if (status === "LOGGED_IN") {
    return "Facebook is logged in for this browser profile.";
  }

  if (status === "LOGIN_REQUIRED") {
    return "Facebook login is required once for this browser profile.";
  }

  if (status === "TWO_FACTOR_REQUIRED") {
    return "Facebook 2FA verification is required.";
  }

  if (status === "CHECKPOINT_REQUIRED") {
    return "Facebook security checkpoint requires attention.";
  }

  if (
    status === "BROWSER_OPEN" ||
    status === "BROWSER_CLOSED" ||
    status === "PENDING" ||
    status === "UNKNOWN"
  ) {
    return "Facebook identity has not been verified yet.";
  }

  return `Facebook identity: ${readableStatus(value)}.`;
}
