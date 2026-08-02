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
    if (open && !loaded) {
      void loadProfile();
    }
  }, [open, loaded]);

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
