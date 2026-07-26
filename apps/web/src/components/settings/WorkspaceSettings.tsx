"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import styles from "./WorkspaceSettings.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

type AutomationSettings = {
  id: string;
  workspaceId: string;
  timezone: string;
  approvalRequired: boolean;
  autoPublishEnabled: boolean;
  retryLimit: number;
  retryDelayMinutes: number;
  defaultFacebookTime: string;
  defaultTelegramTime: string;
};

type Channel = {
  id: string;
  platform: "FACEBOOK" | "TELEGRAM";
  name: string;
  username: string | null;
  status:
    | "DISCONNECTED"
    | "CONNECTED"
    | "EXPIRED"
    | "ERROR";
};

type Brand = {
  id: string;
  name: string;
  primaryLanguage: string;
  country: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

type LocalPreferences = {
  currency: string;
  defaultModel: string;
  defaultLanguage: string;
};

const DEFAULT_LOCAL_PREFERENCES: LocalPreferences = {
  currency: "MYR",
  defaultModel: "gpt-4.1-mini",
  defaultLanguage: "Chinese and English",
};

export function WorkspaceSettings() {
  const [settings, setSettings] =
    useState<AutomationSettings | null>(null);

  const [channels, setChannels] =
    useState<Channel[]>([]);

  const [brands, setBrands] =
    useState<Brand[]>([]);

  const [localPreferences, setLocalPreferences] =
    useState<LocalPreferences>(
      DEFAULT_LOCAL_PREFERENCES,
    );

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [
        settingsResponse,
        channelsResponse,
        brandsResponse,
      ] = await Promise.all([
        fetch(
          `${API_BASE_URL}/automation/settings`,
          { cache: "no-store" },
        ),
        fetch(
          `${API_BASE_URL}/automation/channels`,
          { cache: "no-store" },
        ),
        fetch(
          `${API_BASE_URL}/brands`,
          { cache: "no-store" },
        ),
      ]);

      if (
        !settingsResponse.ok ||
        !channelsResponse.ok ||
        !brandsResponse.ok
      ) {
        throw new Error(
          "Unable to load workspace settings.",
        );
      }

      const [
        settingsData,
        channelsData,
        brandsData,
      ] = await Promise.all([
        settingsResponse.json() as Promise<AutomationSettings>,
        channelsResponse.json() as Promise<Channel[]>,
        brandsResponse.json() as Promise<Brand[]>,
      ]);

      setSettings(settingsData);
      setChannels(channelsData);
      setBrands(brandsData);

      const stored =
        window.localStorage.getItem(
          "atlas.settings.preferences",
        );

      if (stored) {
        try {
          setLocalPreferences({
            ...DEFAULT_LOCAL_PREFERENCES,
            ...JSON.parse(stored),
          });
        } catch {
          setLocalPreferences(
            DEFAULT_LOCAL_PREFERENCES,
          );
        }
      } else if (brandsData[0]) {
        setLocalPreferences((current) => ({
          ...current,
          defaultLanguage:
            brandsData[0].primaryLanguage,
        }));
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workspace = brands[0]?.workspace;
  const activeBrand = brands[0];

  const connectedChannels = useMemo(
    () =>
      channels.filter(
        (channel) =>
          channel.status === "CONNECTED",
      ).length,
    [channels],
  );

  async function saveSettings() {
    if (!settings) {
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/automation/settings`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            timezone: settings.timezone,
            approvalRequired:
              settings.approvalRequired,
            autoPublishEnabled:
              settings.autoPublishEnabled,
            retryLimit:
              Number(settings.retryLimit),
            retryDelayMinutes:
              Number(
                settings.retryDelayMinutes,
              ),
            defaultFacebookTime:
              settings.defaultFacebookTime,
            defaultTelegramTime:
              settings.defaultTelegramTime,
          }),
        },
      );

      if (!response.ok) {
        const body =
          await response.json();

        throw new Error(
          body.message ||
            "Unable to save settings.",
        );
      }

      const updated =
        await response.json() as AutomationSettings;

      setSettings(updated);

      window.localStorage.setItem(
        "atlas.settings.preferences",
        JSON.stringify(localPreferences),
      );

      setMessage(
        "Settings saved successfully.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <section className={styles.state}>
        Loading settings...
      </section>
    );
  }

  if (!settings) {
    return (
      <section className={styles.state}>
        <p>{error || "Settings unavailable."}</p>

        <button onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <div className={styles.settingsPage}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Workspace Administration
          </p>

          <h1>Settings</h1>

          <p>
            Manage workspace preferences,
            publishing defaults and AI behaviour.
          </p>
        </div>

        <button
          className={styles.primaryButton}
          onClick={() => void saveSettings()}
          disabled={saving}
        >
          {saving
            ? "Saving..."
            : "Save changes"}
        </button>
      </section>

      {message ? (
        <div className={styles.success}>
          {message}
        </div>
      ) : null}

      {error ? (
        <div className={styles.error}>
          {error}
        </div>
      ) : null}

      <section className={styles.summaryGrid}>
        <article>
          <span>Workspace</span>
          <strong>
            {workspace?.name || "Atlas"}
          </strong>
          <small>
            {workspace?.slug || "workspace"}
          </small>
        </article>

        <article>
          <span>Active brand</span>
          <strong>
            {activeBrand?.name || "No brand"}
          </strong>
          <small>
            {activeBrand?.country || "Malaysia"}
          </small>
        </article>

        <article>
          <span>Channels</span>
          <strong>
            {connectedChannels}/{channels.length}
          </strong>
          <small>Connected platforms</small>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Workspace
              </p>
              <h2>General preferences</h2>
            </div>
          </header>

          <div className={styles.formGrid}>
            <label>
              <span>Workspace name</span>
              <input
                value={
                  workspace?.name || ""
                }
                disabled
              />
            </label>

            <label>
              <span>Default brand</span>
              <input
                value={
                  activeBrand?.name || ""
                }
                disabled
              />
            </label>

            <label>
              <span>Timezone</span>
              <select
                value={settings.timezone}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          timezone:
                            event.target.value,
                        }
                      : current,
                  )
                }
              >
                <option value="Asia/Kuala_Lumpur">
                  Asia/Kuala_Lumpur
                </option>
                <option value="Asia/Singapore">
                  Asia/Singapore
                </option>
                <option value="UTC">
                  UTC
                </option>
              </select>
            </label>

            <label>
              <span>Currency</span>
              <select
                value={
                  localPreferences.currency
                }
                onChange={(event) =>
                  setLocalPreferences(
                    (current) => ({
                      ...current,
                      currency:
                        event.target.value,
                    }),
                  )
                }
              >
                <option value="MYR">
                  MYR
                </option>
                <option value="USD">
                  USD
                </option>
                <option value="SGD">
                  SGD
                </option>
              </select>
            </label>

            <label>
              <span>Default language</span>
              <select
                value={
                  localPreferences
                    .defaultLanguage
                }
                onChange={(event) =>
                  setLocalPreferences(
                    (current) => ({
                      ...current,
                      defaultLanguage:
                        event.target.value,
                    }),
                  )
                }
              >
                <option value="Chinese and English">
                  Chinese and English
                </option>
                <option value="Chinese">
                  Chinese
                </option>
                <option value="English">
                  English
                </option>
              </select>
            </label>

            <label>
              <span>Default AI model</span>
              <select
                value={
                  localPreferences.defaultModel
                }
                onChange={(event) =>
                  setLocalPreferences(
                    (current) => ({
                      ...current,
                      defaultModel:
                        event.target.value,
                    }),
                  )
                }
              >
                <option value="gpt-4.1-mini">
                  GPT-4.1 Mini
                </option>
                <option value="gpt-4.1">
                  GPT-4.1
                </option>
                <option value="gpt-4.1-nano">
                  GPT-4.1 Nano
                </option>
              </select>
            </label>
          </div>
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Publishing
              </p>
              <h2>Automation defaults</h2>
            </div>
          </header>

          <div className={styles.toggleList}>
            <label>
              <div>
                <strong>
                  Approval required
                </strong>
                <span>
                  Require approval before
                  scheduling content.
                </span>
              </div>

              <input
                type="checkbox"
                checked={
                  settings.approvalRequired
                }
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          approvalRequired:
                            event.target.checked,
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <div>
                <strong>
                  Auto publish
                </strong>
                <span>
                  Automatically send queued
                  posts when due.
                </span>
              </div>

              <input
                type="checkbox"
                checked={
                  settings.autoPublishEnabled
                }
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          autoPublishEnabled:
                            event.target.checked,
                        }
                      : current,
                  )
                }
              />
            </label>
          </div>

          <div className={styles.formGrid}>
            <label>
              <span>
                Default Facebook time
              </span>
              <input
                type="time"
                value={
                  settings.defaultFacebookTime
                }
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          defaultFacebookTime:
                            event.target.value,
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <span>
                Default Telegram time
              </span>
              <input
                type="time"
                value={
                  settings.defaultTelegramTime
                }
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          defaultTelegramTime:
                            event.target.value,
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <span>Retry attempts</span>
              <input
                type="number"
                min="0"
                max="10"
                value={settings.retryLimit}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          retryLimit:
                            Number(
                              event.target.value,
                            ),
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <span>
                Retry delay (minutes)
              </span>
              <input
                type="number"
                min="1"
                max="1440"
                value={
                  settings.retryDelayMinutes
                }
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          retryDelayMinutes:
                            Number(
                              event.target.value,
                            ),
                        }
                      : current,
                  )
                }
              />
            </label>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>
              Connections
            </p>
            <h2>Social channels</h2>
          </div>

          <a href="/automation">
            Open automation
          </a>
        </header>

        <div className={styles.channelGrid}>
          {channels.map((channel) => (
            <article key={channel.id}>
              <div
                className={`${styles.channelIcon} ${
                  channel.platform ===
                  "FACEBOOK"
                    ? styles.facebook
                    : styles.telegram
                }`}
              >
                {channel.platform ===
                "FACEBOOK"
                  ? "f"
                  : "✈"}
              </div>

              <div>
                <strong>{channel.name}</strong>
                <span>
                  {channel.username
                    ? `@${channel.username}`
                    : "No username"}
                </span>
              </div>

              <b
                className={
                  channel.status ===
                  "CONNECTED"
                    ? styles.connected
                    : styles.disconnected
                }
              >
                {channel.status}
              </b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
