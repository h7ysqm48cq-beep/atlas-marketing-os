"use client";

import {
  useEffect,
  useState,
} from "react";
import { API_URL } from "@/lib/api";
import styles from "./RuntimeProfileEditor.module.css";

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type RuntimeProfile = {
  id: string | null;
  channelId: string;
  browserProfileKey: string;
  browserProfileName: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyCountry: string | null;
  hasProxyUsername: boolean;
  hasProxyPassword: boolean;
  lastKnownIp: string | null;
  lastConnectionStatus: string | null;
  lastConnectionError: string | null;
  lastConnectionTestAt: string | null;
};

type RuntimeProfileResponse = {
  exists: boolean;
  profile: RuntimeProfile;
};

type BrowserSession = {
  channelId: string;
  browserProfileKey: string;
  profileDirectory: string;
  openedAt: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  headless: boolean;
  currentUrl: string | null;
};

type BrowserStatusResponse = {
  running: boolean;
  session?: BrowserSession;
};

type BrowserIpResponse = {
  success: boolean;
  browserProfileKey?: string;
  proxyType?: ProxyType;
  ip?: string | null;
  latencyMs?: number;
  message?: string;
};

type FormState = {
  browserProfileName: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  proxyCountry: string;
};

const EMPTY_FORM: FormState = {
  browserProfileName: "",
  locale: "en-MY",
  timezone: "Asia/Kuala_Lumpur",
  proxyType: "DIRECT",
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
  proxyCountry: "",
};

export function RuntimeProfileEditor({
  channelId,
}: {
  channelId: string;
}) {
  const [open, setOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [testing, setTesting] =
    useState(false);

  const [
    browserAction,
    setBrowserAction,
  ] = useState<
    | "open"
    | "status"
    | "ip"
    | "close"
    | null
  >(null);

  const [
    browserRunning,
    setBrowserRunning,
  ] = useState(false);

  const [
    browserSession,
    setBrowserSession,
  ] = useState<
    BrowserSession | null
  >(null);

  const [
    browserIp,
    setBrowserIp,
  ] = useState<string | null>(
    null,
  );

  const [
    browserLatency,
    setBrowserLatency,
  ] = useState<number | null>(
    null,
  );

  const [loaded, setLoaded] =
    useState(false);

  const [profile, setProfile] =
    useState<RuntimeProfile | null>(
      null,
    );

  const [form, setForm] =
    useState<FormState>(
      EMPTY_FORM,
    );

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!loaded) {
      void loadProfile();
    }

    void refreshBrowserStatus(
      true,
    );
  }, [open, loaded]); // eslint-disable-line react-hooks/exhaustive-deps -- Opening and hydration state control profile/status refreshes.

  function applyProfile(
    nextProfile: RuntimeProfile,
  ) {
    setProfile(nextProfile);

    setForm({
      browserProfileName:
        nextProfile.browserProfileName,
      locale:
        nextProfile.locale,
      timezone:
        nextProfile.timezone,
      proxyType:
        nextProfile.proxyType,
      proxyHost:
        nextProfile.proxyHost || "",
      proxyPort:
        nextProfile.proxyPort
          ? String(
              nextProfile.proxyPort,
            )
          : "",
      proxyUsername: "",
      proxyPassword: "",
      proxyCountry:
        nextProfile.proxyCountry || "",
    });
  }

  async function loadProfile() {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/runtime-profile`,
          {
            cache: "no-store",
          },
        );

      const body =
        (await response.json()) as
          | RuntimeProfileResponse
          | {
              message?: string;
            };

      if (
        !response.ok ||
        !("profile" in body)
      ) {
        throw new Error(
          "message" in body &&
            body.message
            ? body.message
            : "Unable to load runtime profile.",
        );
      }

      applyProfile(
        body.profile,
      );

      setLoaded(true);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load runtime profile.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    const proxyPort =
      form.proxyPort.trim()
        ? Number(
            form.proxyPort,
          )
        : null;

    if (
      form.proxyType !== "DIRECT" &&
      !form.proxyHost.trim()
    ) {
      setError(
        "Proxy host is required.",
      );
      return;
    }

    if (
      proxyPort !== null &&
      (
        !Number.isInteger(
          proxyPort,
        ) ||
        proxyPort < 1 ||
        proxyPort > 65535
      )
    ) {
      setError(
        "Proxy port must be between 1 and 65535.",
      );
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/runtime-profile`,
          {
            method: "PUT",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              browserProfileName:
                form.browserProfileName,
              locale:
                form.locale,
              timezone:
                form.timezone,
              proxyType:
                form.proxyType,
              proxyHost:
                form.proxyType ===
                "DIRECT"
                  ? null
                  : form.proxyHost,
              proxyPort:
                form.proxyType ===
                "DIRECT"
                  ? null
                  : proxyPort,
              proxyUsername:
                form.proxyType ===
                "DIRECT"
                  ? null
                  : form.proxyUsername ||
                    undefined,
              proxyPassword:
                form.proxyType ===
                "DIRECT"
                  ? null
                  : form.proxyPassword ||
                    undefined,
              proxyCountry:
                form.proxyType ===
                "DIRECT"
                  ? null
                  : form.proxyCountry,
            }),
          },
        );

      const body =
        (await response.json()) as
          | RuntimeProfileResponse
          | {
              message?: string;
            };

      if (
        !response.ok ||
        !("profile" in body)
      ) {
        throw new Error(
          "message" in body &&
            body.message
            ? body.message
            : "Unable to save runtime profile.",
        );
      }

      applyProfile(
        body.profile,
      );

      setMessage(
        "Runtime profile saved.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save runtime profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/runtime-profile/test-proxy`,
          {
            method: "POST",
          },
        );

      const body =
        (await response.json()) as {
          success?: boolean;
          message?: string;
          details?: string;
          profile?: RuntimeProfile;
          connection?: {
            mode?: string;
            ip?: string;
            latencyMs?: number;
            testedAt?: string;
          };
        };

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          body.details ||
            body.message ||
            "Connection test failed.",
        );
      }

      if (body.profile) {
        applyProfile(
          body.profile,
        );
      }

      setMessage(
        [
          "Connection successful.",
          body.connection?.ip
            ? `IP: ${body.connection.ip}.`
            : "",
          typeof body.connection
            ?.latencyMs ===
          "number"
            ? `Latency: ${body.connection.latencyMs} ms.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "Connection test failed.",
      );

      await loadProfile();
    } finally {
      setTesting(false);
    }
  }

  async function readJson(
    response: Response,
  ) {
    const raw =
      await response.text();

    if (!raw.trim()) {
      return {};
    }

    try {
      return JSON.parse(
        raw,
      ) as Record<
        string,
        unknown
      >;
    } catch {
      return {
        message: raw,
      };
    }
  }

  function getResponseMessage(
    body: Record<
      string,
      unknown
    >,
    fallback: string,
  ) {
    const message =
      body.message;

    if (
      typeof message ===
        "string" &&
      message.trim()
    ) {
      return message;
    }

    const nestedError =
      body.error;

    if (
      nestedError &&
      typeof nestedError ===
        "object" &&
      "message" in nestedError &&
      typeof nestedError
        .message ===
        "string"
    ) {
      return nestedError.message;
    }

    return fallback;
  }

  async function refreshBrowserStatus(
    silent = false,
  ) {
    if (!silent) {
      setBrowserAction(
        "status",
      );
      setMessage("");
      setError("");
    }

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/browser/status`,
          {
            cache:
              "no-store",
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            body,
            "Unable to read browser status.",
          ),
        );
      }

      const status =
        body as BrowserStatusResponse;

      setBrowserRunning(
        Boolean(
          status.running,
        ),
      );

      setBrowserSession(
        status.session ||
          null,
      );

      if (
        !status.running
      ) {
        setBrowserIp(null);
        setBrowserLatency(
          null,
        );
      }

      if (!silent) {
        setMessage(
          status.running
            ? "Browser profile is running."
            : "Browser profile is stopped.",
        );
      }
    } catch (statusError) {
      setBrowserRunning(
        false,
      );
      setBrowserSession(
        null,
      );

      if (!silent) {
        setError(
          statusError instanceof
            Error
            ? statusError.message
            : "Unable to read browser status.",
        );
      }
    } finally {
      if (!silent) {
        setBrowserAction(
          null,
        );
      }
    }
  }

  async function openBrowser() {
    if (!profile?.id) {
      setError(
        "Save the runtime profile before opening the browser.",
      );
      return;
    }

    setBrowserAction(
      "open",
    );
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/browser/open`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              headless: false,
            }),
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            body,
            "Unable to open browser profile.",
          ),
        );
      }

      const session =
        body.session as
          | BrowserSession
          | undefined;

      setBrowserRunning(
        true,
      );

      setBrowserSession(
        session || null,
      );

      setMessage(
        body.alreadyRunning
          ? "Browser profile is already running."
          : "Browser profile opened successfully.",
      );
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Unable to open browser profile.",
      );
    } finally {
      setBrowserAction(
        null,
      );
    }
  }

  async function checkBrowserIp() {
    setBrowserAction(
      "ip",
    );
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/browser/check-ip`,
          {
            method: "POST",
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            body,
            "Unable to inspect browser IP.",
          ),
        );
      }

      const result =
        body as BrowserIpResponse;

      setBrowserIp(
        result.ip || null,
      );

      setBrowserLatency(
        typeof result.latencyMs ===
          "number"
          ? result.latencyMs
          : null,
      );

      setMessage(
        [
          "Browser connection is healthy.",
          result.ip
            ? `IP: ${result.ip}.`
            : "",
          typeof result.latencyMs ===
            "number"
            ? `Latency: ${result.latencyMs} ms.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (ipError) {
      setError(
        ipError instanceof Error
          ? ipError.message
          : "Unable to inspect browser IP.",
      );
    } finally {
      setBrowserAction(
        null,
      );
    }
  }

  async function closeBrowser() {
    setBrowserAction(
      "close",
    );
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels/${channelId}/browser/close`,
          {
            method: "POST",
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            body,
            "Unable to close browser profile.",
          ),
        );
      }

      setBrowserRunning(
        false,
      );

      setBrowserSession(
        null,
      );

      setBrowserIp(null);
      setBrowserLatency(
        null,
      );

      setMessage(
        body.alreadyStopped
          ? "Browser profile was already stopped."
          : "Browser profile closed.",
      );
    } catch (closeError) {
      setError(
        closeError instanceof Error
          ? closeError.message
          : "Unable to close browser profile.",
      );
    } finally {
      setBrowserAction(
        null,
      );
    }
  }


  function updateForm<
    K extends keyof FormState,
  >(
    key: K,
    value: FormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <section
      className={styles.editor}
    >
      <button
        type="button"
        className={styles.toggle}
        onClick={() =>
          setOpen(
            (current) =>
              !current,
          )
        }
      >
        <span>
          Runtime Profile
        </span>

        <b>
          {profile?.proxyType ||
            "Not configured"}
        </b>

        <i>
          {open ? "−" : "+"}
        </i>
      </button>

      {open ? (
        <div
          className={
            styles.content
          }
        >
          {loading ? (
            <p
              className={
                styles.status
              }
            >
              Loading runtime
              profile...
            </p>
          ) : (
            <>
              <div
                className={
                  styles.formGrid
                }
              >
                <label
                  className={
                    styles.full
                  }
                >
                  <span>
                    Browser profile
                    name
                  </span>

                  <input
                    value={
                      form.browserProfileName
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        "browserProfileName",
                        event.target
                          .value,
                      )
                    }
                  />
                </label>

                <label>
                  <span>Locale</span>

                  <select
                    value={
                      form.locale
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        "locale",
                        event.target
                          .value,
                      )
                    }
                  >
                    <option value="en-MY">
                      English ·
                      Malaysia
                    </option>

                    <option value="zh-MY">
                      Chinese ·
                      Malaysia
                    </option>

                    <option value="ms-MY">
                      Malay ·
                      Malaysia
                    </option>

                    <option value="en-SG">
                      English ·
                      Singapore
                    </option>
                  </select>
                </label>

                <label>
                  <span>
                    Timezone
                  </span>

                  <select
                    value={
                      form.timezone
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        "timezone",
                        event.target
                          .value,
                      )
                    }
                  >
                    <option value="Asia/Kuala_Lumpur">
                      Asia/Kuala
                      Lumpur
                    </option>

                    <option value="Asia/Singapore">
                      Asia/Singapore
                    </option>

                    <option value="Asia/Bangkok">
                      Asia/Bangkok
                    </option>

                    <option value="UTC">
                      UTC
                    </option>
                  </select>
                </label>

                <label>
                  <span>
                    Connection
                  </span>

                  <select
                    value={
                      form.proxyType
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        "proxyType",
                        event.target
                          .value as
                          ProxyType,
                      )
                    }
                  >
                    <option value="DIRECT">
                      Direct
                    </option>

                    <option value="HTTP">
                      HTTP Proxy
                    </option>

                    <option value="HTTPS">
                      HTTPS Proxy
                    </option>

                    <option value="SOCKS5">
                      SOCKS5 Proxy
                    </option>
                  </select>
                </label>

                {form.proxyType !==
                "DIRECT" ? (
                  <>
                    <label>
                      <span>
                        Proxy host
                      </span>

                      <input
                        value={
                          form.proxyHost
                        }
                        onChange={(
                          event,
                        ) =>
                          updateForm(
                            "proxyHost",
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder="proxy.example.com"
                      />
                    </label>

                    <label>
                      <span>
                        Proxy port
                      </span>

                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={
                          form.proxyPort
                        }
                        onChange={(
                          event,
                        ) =>
                          updateForm(
                            "proxyPort",
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder="8080"
                      />
                    </label>

                    <label>
                      <span>
                        Username
                      </span>

                      <input
                        value={
                          form.proxyUsername
                        }
                        onChange={(
                          event,
                        ) =>
                          updateForm(
                            "proxyUsername",
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder={
                          profile?.hasProxyUsername
                            ? "Configured · leave blank to keep"
                            : "Optional"
                        }
                      />
                    </label>

                    <label>
                      <span>
                        Password
                      </span>

                      <input
                        type="password"
                        value={
                          form.proxyPassword
                        }
                        onChange={(
                          event,
                        ) =>
                          updateForm(
                            "proxyPassword",
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder={
                          profile?.hasProxyPassword
                            ? "Configured · leave blank to keep"
                            : "Optional"
                        }
                      />
                    </label>

                    <label
                      className={
                        styles.full
                      }
                    >
                      <span>
                        Proxy country
                      </span>

                      <input
                        value={
                          form.proxyCountry
                        }
                        onChange={(
                          event,
                        ) =>
                          updateForm(
                            "proxyCountry",
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder="Malaysia"
                      />
                    </label>
                  </>
                ) : null}
              </div>

              {profile ? (
                <div
                  className={
                    styles.diagnostics
                  }
                >
                  <div>
                    <span>
                      Profile key
                    </span>
                    <strong>
                      {
                        profile.browserProfileKey
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      Last IP
                    </span>
                    <strong>
                      {profile.lastKnownIp ||
                        "Not tested"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Status
                    </span>
                    <strong>
                      {profile.lastConnectionStatus ||
                        "Not tested"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Last test
                    </span>
                    <strong>
                      {profile.lastConnectionTestAt
                        ? new Date(
                            profile.lastConnectionTestAt,
                          ).toLocaleString()
                        : "Never"}
                    </strong>
                  </div>
                </div>
              ) : null}

              <section
                className={
                  styles.browserRuntime
                }
              >
                <header
                  className={
                    styles.browserHeader
                  }
                >
                  <div>
                    <span>
                      Browser Runtime
                    </span>

                    <strong>
                      Independent Chrome
                      session
                    </strong>
                  </div>

                  <b
                    className={
                      browserRunning
                        ? styles.browserRunning
                        : styles.browserStopped
                    }
                  >
                    {browserRunning
                      ? "Running"
                      : "Stopped"}
                  </b>
                </header>

                <div
                  className={
                    styles.browserDetails
                  }
                >
                  <div>
                    <span>
                      Profile
                    </span>

                    <strong>
                      {browserSession
                        ?.browserProfileKey ||
                        profile
                          ?.browserProfileKey ||
                        "Unavailable"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Current URL
                    </span>

                    <strong>
                      {browserSession
                        ?.currentUrl ||
                        "Not running"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Browser IP
                    </span>

                    <strong>
                      {browserIp ||
                        "Not checked"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Latency
                    </span>

                    <strong>
                      {browserLatency !==
                      null
                        ? `${browserLatency} ms`
                        : "Not checked"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Opened
                    </span>

                    <strong>
                      {browserSession
                        ?.openedAt
                        ? new Date(
                            browserSession.openedAt,
                          ).toLocaleString()
                        : "Not running"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Mode
                    </span>

                    <strong>
                      {browserSession
                        ? browserSession.headless
                          ? "Headless"
                          : "Visible"
                        : "Visible"}
                    </strong>
                  </div>
                </div>

                <div
                  className={
                    styles.browserActions
                  }
                >
                  {!browserRunning ? (
                    <button
                      type="button"
                      onClick={() =>
                        void openBrowser()
                      }
                      disabled={
                        browserAction !==
                          null ||
                        !profile?.id
                      }
                    >
                      {browserAction ===
                      "open"
                        ? "Opening..."
                        : "Open Browser"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void checkBrowserIp()
                        }
                        disabled={
                          browserAction !==
                          null
                        }
                      >
                        {browserAction ===
                        "ip"
                          ? "Checking..."
                          : "Check IP"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void closeBrowser()
                        }
                        disabled={
                          browserAction !==
                          null
                        }
                      >
                        {browserAction ===
                        "close"
                          ? "Closing..."
                          : "Close Browser"}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      void refreshBrowserStatus()
                    }
                    disabled={
                      browserAction !==
                      null
                    }
                  >
                    {browserAction ===
                    "status"
                      ? "Refreshing..."
                      : "Refresh Status"}
                  </button>
                </div>

                {!profile?.id ? (
                  <small
                    className={
                      styles.hint
                    }
                  >
                    Save the runtime
                    profile before
                    opening its browser.
                  </small>
                ) : null}
              </section>

              {message ? (
                <p
                  className={
                    styles.success
                  }
                >
                  {message}
                </p>
              ) : null}

              {error ? (
                <p
                  className={
                    styles.error
                  }
                >
                  {error}
                </p>
              ) : null}

              <div
                className={
                  styles.actions
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    void saveProfile()
                  }
                  disabled={
                    saving ||
                    testing
                  }
                >
                  {saving
                    ? "Saving..."
                    : "Save profile"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void testConnection()
                  }
                  disabled={
                    saving ||
                    testing ||
                    !profile?.id
                  }
                >
                  {testing
                    ? "Testing..."
                    : "Test connection"}
                </button>
              </div>

              {!profile?.id ? (
                <small
                  className={
                    styles.hint
                  }
                >
                  Save the profile
                  before testing the
                  connection.
                </small>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
